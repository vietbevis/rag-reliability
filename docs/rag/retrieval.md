# Retrieval (PHASE 4 · vector; PHASE 6 · keyword + graph + hybrid + fusion)

## Vấn đề

Retrieval quyết định trần chất lượng của cả pipeline: nếu chunk lấy về không
chứa câu trả lời thì rerank, grounding, faithfulness đều vô nghĩa — LLM buộc
phải bịa hoặc abstain (PROMPT §16). Cần:

- truy hồi **đúng embedding model** đã dùng lúc ingest (lệch model → 0 kết quả),
- **chuẩn hoá điểm** về một thang chung để fusion (P6) hợp nhất được nhiều
  nguồn,
- **lọc metadata** (document, source, khoá tuỳ ý) để thu hẹp không gian tìm
  (PROMPT §12),
- chỉ tìm trong tài liệu đã `COMPLETED` (đã embedding xong),
- **không bao giờ ném khi "không tìm thấy"** — trả rỗng, để fusion vẫn chạy
  với nguồn khác (PROMPT §54).

## `Retriever` — interface chung

Mọi cách truy hồi implement chung một hợp đồng
(`src/rag/retrieval/retriever.interface.ts`):

```ts
interface Retriever {
  readonly source: 'vector' | 'keyword' | 'graph' | 'hybrid';
  retrieve(o: {
    query: string;
    topK: number;
    filters?: RetrievalFilters;
  }): Promise<RetrieverResult>;
}

interface RetrieverResult {
  chunks: RetrievedChunk[]; // score ∈ [0,1], cao = liên quan hơn
  latencyMs: number;
  embeddingTokens: number; // nếu retriever cần embed query
  estimatedCost: number;
  trace: Record<string, unknown>; // debug cho §38
}
```

| Retriever   | Phase | Nguồn dữ liệu                          |
| ----------- | ----- | ------------------------------------- |
| `vector`    | 4     | pgvector (`Embedding.embedding`)      |
| `keyword`   | 6     | PostgreSQL full-text (`tsvector`)     |
| `graph`     | 6     | Neo4j local traversal (xem graph-rag) |
| `hybrid`    | 6     | fusion RRF/weighted của 3 cái trên    |

## `RetrievalFilters` (metadata filtering — §12)

```ts
{
  documentIds?: string[];   // chỉ tìm trong các document này
  sources?: string[];       // lọc theo Document.source
  metadata?: Record<string, string | number | boolean>; // khớp DocumentChunk.metadata ->> key
}
```

Mọi giá trị filter đi vào `$queryRaw` dưới dạng **bind parameter** (`Prisma.sql`),
không nối chuỗi → an toàn injection kể cả khi khoá `metadata` do người dùng đặt.

## VectorRetriever (PHASE 4)

`src/rag/retrieval/vector-retriever.service.ts`:

1. `EmbeddingService.embed(query)` → vector câu hỏi (cùng provider/model đang
   active — `EmbeddingService.activeModel`).
2. `$queryRaw`:
   ```sql
   SELECT c.id, c."documentId", c.content, c.heading, c.section, c.page, c.metadata,
          e."embedding" <op> $queryVec::vector AS distance
   FROM "Embedding" e
   JOIN "DocumentChunk" c ON c.id = e."chunkId"
   JOIN "Document" d      ON d.id = c."documentId"
   WHERE e."model" = $model
     AND d."status" = 'COMPLETED'
     [AND c."documentId" IN (...) | d."source" IN (...) | c."metadata" ->> $k = $v]
   ORDER BY distance ASC
   LIMIT $topK
   ```
   `<op>` = `<=>` (cosine) / `<->` (l2) / `<#>` (ip) theo `EMBEDDING_DISTANCE`,
   khớp opclass của HNSW index (`VectorSchemaService.distanceOperator`).
3. Chuẩn hoá `score`:
   - **cosine**: `1 - distance/2` (distance ∈ [0,2] → score ∈ [1,0]).
   - l2/ip: `1/(1+distance)` (xấp xỉ; cosine là mặc định và chính xác nhất cho
     embedding đã normalize).

### Tinh chỉnh HNSW lúc query (PHASE 16 — Supabase / pgvector playbook)

`hnsw.ef_search` (mặc định pgvector = 40) là nút chỉnh recall/tốc độ chính. Filter
trong `WHERE` **không** bỏ qua index nhưng được áp SAU index scan → nếu filter
chọn lọc, HNSW dễ trả thiếu kết quả ("overfiltering").

| Env | Mặc định | Tác dụng |
| --- | --- | --- |
| `RETRIEVAL_HNSW_EF_SEARCH` | `0` (= giữ 40) | `>0` → `SET LOCAL hnsw.ef_search = N` cho MỌI query. Supabase: 100 ≈ acc@10 0.98; 250 ≈ 0.99. Chậm hơn tuyến tính. |
| `RETRIEVAL_HNSW_ITERATIVE_SCAN` | `false` | `true` + query CÓ filter `metadata`/`documentIds` → thêm `SET LOCAL hnsw.iterative_scan = relaxed_order` (pgvector quét tiếp cho đủ kết quả). **GUC này chỉ có ở pgvector ≥ 0.8** — chỉ bật khi chắc chắn phiên bản. |

Khi có tham số cần set, query chạy trong 1 `$transaction` (`SET LOCAL` + `SELECT`);
`trace.<source>.hnswTuning` ghi các lệnh đã áp. Không có tham số → query đơn như cũ.

**Tham số BUILD index** (`m`, `ef_construction`) khai báo trong migration
`20260830004012_phase16_hnsw_index_params` — `m=16, ef_construction=128` cho
vector 1024 chiều. Bảng lớn: build tay bằng `CREATE INDEX CONCURRENTLY` +
`prisma migrate resolve --applied` (xem comment trong migration).

### Đòn bẩy khi corpus lớn (chưa hiện thực)

- **`halfvec(1024)`** — index nửa kích thước (2 byte/chiều), recall giảm không
  đáng kể: `USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)`.
- **inner product** cho vector đã normalize (e5 có normalize) — `<#>` /
  `vector_ip_ops`, nhanh hơn cosine một chút (`EMBEDDING_DISTANCE=ip` + rebuild index).
- **binary quantization + rerank exact** — index ~32× nhỏ hơn, dùng khi hàng triệu vector.
- **`pg_prewarm`** index + 10k–50k query warm-up trước khi vào production (Supabase:
  "giữ index trong RAM là yếu tố quan trọng nhất").

### Chẩn đoán chậm

`trace.retrieval.latencyMs` (tổng) + `trace.retrieval.<source>.latencyMs` (từng
nguồn) trong response `/rag/query` (PHASE 16). So với `trace.generation.latencyMs`
+ `trace.faithfulness.latencyMs` để biết nút thắt. Nếu `VectorSchemaService` log
_"Chưa có ANN index — vector search sẽ quét tuần tự"_ lúc boot → chạy
`npm run prisma:deploy` (KHÔNG `migrate dev` — sẽ lại drop index vector/tsvector).

`RetrievalService` (orchestrator) — PHASE 4 chỉ gọi `vector`; PHASE 6 gọi cả 3
+ fusion. Mỗi lần truy hồi ghi một `RetrievalLog`
(`{ query, strategy, topK, filters, results: [{chunkId, documentId, score, source}], latencyMs, ragQueryId? }`)
để **debug retrieval độc lập với generation** (§40). Lỗi ghi log bị nuốt (log
không được làm hỏng truy vấn).

## Keyword retrieval (PHASE 6)

`src/rag/retrieval/keyword-retriever.service.ts`:

1. **Full-text search với cấu hình 'simple'**:
   PostgreSQL không tích hợp sẵn bộ phân tích từ tiếng Việt (Vietnamese dictionary/stemmer). Dùng cấu hình `'simple'` để thực hiện tokenize + lowercase nguyên bản, đảm bảo khớp chính xác các từ tố, thuật ngữ kỹ thuật, mã văn bản.
2. **Cột generated + Index GIN** (migration `phase6_tsvector`):
   ```sql
   ALTER TABLE "DocumentChunk" ADD COLUMN "contentTsv" tsvector
     GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;
   CREATE INDEX "DocumentChunk_contentTsv_idx"
     ON "DocumentChunk" USING GIN ("contentTsv");
   ```
   Cột generated → `to_tsvector` KHÔNG tính lại mỗi row (SELECT ts_rank + WHERE
   @@), và GIN index dùng trực tiếp trên cột. Prisma: `Unsupported("tsvector")?`.
3. **Truy vấn với `$queryRaw`** — `websearch_to_tsquery('simple', $query)` +
   `ts_rank(c."contentTsv", ...)`:
   ```sql
   SELECT ..., ts_rank(c."contentTsv", websearch_to_tsquery('simple', $query)) AS rank
   FROM "DocumentChunk" c JOIN "Document" d ON d."id" = c."documentId"
   WHERE c."contentTsv" @@ websearch_to_tsquery('simple', $query)
     AND d."status" = 'COMPLETED'::"DocumentStatus"
     [AND c."documentId" IN (...) | d."source" IN (...) | c."metadata" ->> $k = $v]
   ORDER BY rank DESC LIMIT $topK
   ```
   `$queryRaw` bọc try/catch → lỗi DB trả `emptyResult({ error: 'keyword_db_failed' })`
   (hợp đồng Retriever, §54).
4. **Khi nào keyword thắng vector (PROMPT §17)**:
   - Truy vấn chứa **mã văn bản**, số hiệu quyết định (ví dụ: `123/QĐ-ĐHQG`, `Nghị định 45/2020`). Embedding model thường bị trôi vector hoặc xem các mã số như token ngẫu nhiên, trong khi keyword search khớp chính xác 100%.
   - **Tên riêng**, từ viết tắt, mã môn học, tên quy chuẩn hiếm gặp.
   - Khi embedding provider chưa sẵn sàng hoặc gặp sự cố mạng/hạn mức, keyword search trên Postgres vẫn chạy ổn định (zero external dependency).
5. **Chuẩn hoá điểm `score`** — `ts_rank` tuyệt đối rất nhỏ (~0.01–0.08). Chuẩn
   hoá **theo batch**: `score = rank / max(rank trong lượt)`. Kết quả khớp tốt
   nhất ≈ 1.0 (nhất quán với cách vector/graph chuẩn hoá tương đối), rank tuyệt
   đối nhỏ không còn làm score chìm khi weighted fusion / khi `ContextValidator`
   so ngưỡng ở strategy `keyword` đơn lẻ.
6. **Xử lý query đặc biệt**:
   Nếu câu query rỗng hoặc toàn ký tự đặc biệt (không chứa ký tự chữ/số nào), service trả về ngay `emptyResult({ reason: 'empty_tsquery' })` mà không cần gọi database.


## Graph retrieval (PHASE 6)

`GraphRetrieverService` (implement `Retriever`, `source='graph'`) — chỉ hoạt động
khi `GRAPH_RAG_ENABLED=true`. Luồng (graph-rag.md §4):

1. **Entity linking** (`GraphEntityLinkerService`, 3 tầng, dừng ở tầng đầu có kết quả):
   1. **fulltext** — Neo4j fulltext index `entity_name_fts` (`db.index.fulltext.
      queryNodes`) lấy ứng viên theo token, rồi **hậu lọc** trong TS: tên (chuẩn
      hoá) phải là chuỗi con của query VÀ (đa từ HOẶC ≥6 ký tự) — chặn
      false-positive từ ngắn kiểu "Nam", "Ban", "Văn". Rẻ, không LLM.
   2. alias (`EntityAlias`) — **hoãn** (chưa có bảng).
   3. **LLM** (`GRAPH_LINK_USE_LLM=true`) — rút danh sách thực thể từ query bằng
      structured output, khớp lại `toLower(Entity.name)`.
   Neo4j LỖI ở bất kỳ tầng nào → `error: 'neo4j_unavailable'` → GraphRetriever
   tính vào circuit-breaker + báo `trace.error` (KHÔNG nhầm với `no_seed_entity`).
2. **Traversal** — `MATCH (s)-[:RELATED*1..GRAPH_MAX_HOPS]-(:Entity)`, loại đỉnh
   `degree > GRAPH_MAX_ENTITY_DEGREE` (chống nổ trên hub entity), sắp theo tổng
   `weight` đường đi, `LIMIT GRAPH_RETRIEVAL_TOP_K`. `hops/topK/maxDegree` nội suy
   trực tiếp (int đã validate — Cypher `LIMIT` không nhận param-float).
3. **Gom evidence** — union `chunkIds` trên các cạnh `RELATED` đi qua + `MENTIONED_IN`
   của seed (điểm nền 0.5). Load chunk từ Postgres (áp `RetrievalFilters` + chỉ
   `COMPLETED`). `score = 0.1 + 0.9·(pathScore / maxPathScore)` → [0,1].
4. **Circuit-breaker** — 3 lỗi Neo4j liên tiếp → `trace.skipped='circuit_open'`,
   bỏ qua graph 30s (giữ RAG chạy tiếp — §54). Seed rỗng → `trace.reason='no_seed_entity'`
   (KHÔNG phải lỗi).

## Fusion (PHASE 6)

`fusion.ts` (hàm thuần) hợp nhất kết quả nhiều retriever khi `strategy='hybrid'`:

- **RRF** (mặc định, `FUSION_METHOD=rrf`): `Σ_r w_r / (FUSION_RRF_K + rank_r)` —
  bền vững, KHÔNG cần score các nguồn cùng thang đo.
- **weighted**: `Σ_r w_r · score_r` — dùng khi score đã chuẩn hoá [0,1].
- Trọng số: `FUSION_WEIGHT_{VECTOR,KEYWORD,GRAPH}`.
- Chunk trùng `chunkId` giữa các nguồn → cộng điểm, `source='hybrid'`,
  `metadata.fusion` ghi rank/score từng nguồn (trace).
- Chỉ 1 nguồn có kết quả → pass-through (không đổi score/source).
- Score hợp nhất chuẩn hoá về [0,1] bằng cách chia cho **trần LÝ THUYẾT** (một
  chunk đứng #1 ở MỌI nguồn): RRF `Σ w_r/(k+1)`, weighted `Σ w_r`. KHÔNG chia cho
  max của batch — nếu không "mọi kết quả đều rác" sẽ bị thổi lên 1.0 và lọt qua
  `ContextValidator` gây hallucination. `metadata.fusion.rawScore` giữ điểm thô.

`RetrievalService` chạy các retriever của `strategy` **song song** (`Promise.all`);
chỉ set `error` toàn cục (→ 502) khi **mọi** nguồn được chọn đều lỗi hạ tầng.

## Table expansion (PHASE 4 — `TableExpansionService`)

Vấn đề: bảng GFM lớn bị chunker cắt thành nhiều mảnh (mỗi mảnh lặp lại header,
mang chung `metadata.tableGroup` — xem `chunking.md`). Vector/keyword thường chỉ
kéo về 1–2 mảnh khớp nhất → câu hỏi kiểu _"liệt kê các mức / tỷ lệ / định mức"_
bị trả lời thiếu và gắn nhãn `PARTIALLY_GROUNDED` oan.

`TableExpansionService.expand(chunks)` chạy trong `RagPipelineService` **sau
rerank, trước ContextBuilder**:

- với mỗi chunk kết quả có `metadata.tableGroup`, truy Postgres lấy **mọi mảnh
  còn lại** cùng `(documentId, tableGroup)` của tài liệu `COMPLETED`;
- mảnh bổ sung nhận `score = score(mảnh kích hoạt) − 1e-4` → nằm liền ngay dưới
  mảnh gốc khi ContextBuilder sắp theo score, cùng lọt/không lọt ngân sách token;
- đánh dấu `metadata.tableExpanded = true`; giữ `source` của mảnh kích hoạt;
- trần `RAG_TABLE_EXPANSION_MAX_CHUNKS` (mặc định 8) chặn phình context;
- lỗi DB khi bổ sung → **không ném**, trả nguyên kết quả gốc (§54).

Cờ: `RAG_TABLE_EXPANSION_ENABLED` (mặc định `true`). `trace.tableExpansion` ghi
`{ enabled, groups, added, capped }`. KHÔNG áp dụng cho `POST /rag/search` (raw
retrieval) — chỉ pipeline sinh câu trả lời.

## API

### `POST /rag/search` — chỉ retrieval, KHÔNG gọi LLM (§40)

Body nhận thêm `strategy?: 'vector' | 'keyword' | 'graph' | 'hybrid'` (ghi đè
`RETRIEVAL_STRATEGY`). `POST /rag/query` cũng vậy.

```json
// request
{ "query": "Sinh viên được bảo lưu bao lâu?", "topK": 5, "filters": { "sources": ["quy-che-dao-tao"] } }

// response
{
  "query": "...", "strategy": "vector", "count": 5, "latencyMs": 42,
  "usage": { "embeddingTokens": 11, "estimatedCost": 0 },
  "results": [
    { "chunkId": "...", "documentId": "...", "score": 0.83, "source": "vector",
      "heading": "Điều 2", "section": "Quy chế > Chương I > Điều 2", "page": null,
      "content": "...", "metadata": { "distance": 0.34, "strategy": "structure", ... } }
  ]
}
```

Mục đích: tách bạch "retrieval có kéo đúng chunk không" với "LLM có trả lời
đúng không" khi debug.

## Failure modes (§54)

| Tình huống                        | Kết quả                                                    |
| -------------------------------- | -------------------------------------------------------- |
| Embedding provider chưa cấu hình | trả `chunks: []`, `trace.skipped`                        |
| Embed query lỗi (API down)       | trả `chunks: []`, `trace.error = 'embed_query_failed'` + log |
| Không có chunk nào khớp filter   | trả `chunks: []` (bình thường, không phải lỗi)           |
| Ghi `RetrievalLog` lỗi           | nuốt + log warn, retrieval vẫn trả kết quả               |
| `hybrid`: 1 nguồn lỗi hạ tầng    | fusion tiếp với nguồn còn lại, KHÔNG báo `error` toàn cục |
| `hybrid`: MỌI nguồn lỗi hạ tầng  | `error` toàn cục → 502 ở controller                       |
| Graph: Neo4j chết nhiều lần      | circuit-breaker mở 30s, `trace.skipped='circuit_open'`   |

## Benchmark — Experiment 002 (§36)

_Vector vs Hybrid_ (P6): chạy golden dataset qua từng chiến lược, so
Recall@5 / Precision@5 / MRR / NDCG@5 / Context Precision / Context Recall +
latency + cost. Kỳ vọng hybrid (vector + keyword) tăng Recall cho câu có mã
văn bản / tên riêng (§17), graph tăng cho multi-hop (§32 Type B).

## Ghi chú hiệu năng (P6+)

`WHERE` **không** làm planner bỏ HNSW index (pgvector docs) — index vẫn scan theo
`ORDER BY embedding <op> const LIMIT k`, filter (`e.model`, `d.status`, filter
người dùng) áp SAU. Hệ quả: nếu filter chọn lọc, HNSW (mặc định `ef_search=40`)
có thể trả **thiếu** kết quả → dùng `RETRIEVAL_HNSW_ITERATIVE_SCAN` (pgvector ≥ 0.8)
hoặc `RETRIEVAL_HNSW_EF_SEARCH` cao hơn (xem "Tinh chỉnh HNSW lúc query" ở trên).
Ở đây `e.model` (một model) + `d.status='COMPLETED'` (gần hết corpus) KHÔNG chọn
lọc → không ảnh hưởng cho tới khi client truyền filter `metadata`/`documentIds`.

Với corpus rất lớn, phương án khác: partial index theo model, `halfvec`, hoặc
materialize "chunk của document COMPLETED". Luôn đo bằng `EXPLAIN (ANALYZE, BUFFERS)`
với query THẬT khi corpus vượt ~50k chunk; kỳ vọng thấy
`Index Scan using Embedding_embedding_hnsw_cosine_idx`, KHÔNG phải `Seq Scan`.
