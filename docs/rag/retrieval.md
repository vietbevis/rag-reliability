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

`RetrievalService` (orchestrator) — PHASE 4 chỉ gọi `vector`; PHASE 6 gọi cả 3
+ fusion. Mỗi lần truy hồi ghi một `RetrievalLog`
(`{ query, strategy, topK, filters, results: [{chunkId, documentId, score, source}], latencyMs, ragQueryId? }`)
để **debug retrieval độc lập với generation** (§40). Lỗi ghi log bị nuốt (log
không được làm hỏng truy vấn).

## Keyword retrieval (PHASE 6)

`src/rag/retrieval/keyword-retriever.service.ts`:

1. **Full-text search với cấu hình 'simple'**:
   PostgreSQL không tích hợp sẵn bộ phân tích từ tiếng Việt (Vietnamese dictionary/stemmer). Dùng cấu hình `'simple'` để thực hiện tokenize + lowercase nguyên bản, đảm bảo khớp chính xác các từ tố, thuật ngữ kỹ thuật, mã văn bản.
2. **Index GIN**:
   Migration PHASE 6 tạo GIN index trên biểu thức `to_tsvector('simple', "content")` của bảng `DocumentChunk` để tăng tốc độ truy vấn:
   ```sql
   CREATE INDEX IF NOT EXISTS "DocumentChunk_content_fts_idx"
     ON "DocumentChunk" USING GIN (to_tsvector('simple', "content"));
   ```
3. **Truy vấn với `$queryRaw`**:
   Dùng `websearch_to_tsquery('simple', $query)` để chuyển câu hỏi người dùng thành `tsquery` an toàn (hỗ trợ toán tử tìm kiếm web cơ bản, không throw lỗi cú pháp) và `ts_rank` để chấm điểm mức độ liên quan:
   ```sql
   SELECT c."id", c."documentId", c."content", c."heading", c."section",
          c."page", c."metadata",
          ts_rank(to_tsvector('simple', c."content"),
                  websearch_to_tsquery('simple', $query)) AS rank
   FROM "DocumentChunk" c
   JOIN "Document" d ON d."id" = c."documentId"
   WHERE to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', $query)
     AND d."status" = 'COMPLETED'::"DocumentStatus"
     [AND c."documentId" IN (...) | d."source" IN (...) | c."metadata" ->> $k = $v]
   ORDER BY rank DESC
   LIMIT $topK
   ```
4. **Khi nào keyword thắng vector (PROMPT §17)**:
   - Truy vấn chứa **mã văn bản**, số hiệu quyết định (ví dụ: `123/QĐ-ĐHQG`, `Nghị định 45/2020`). Embedding model thường bị trôi vector hoặc xem các mã số như token ngẫu nhiên, trong khi keyword search khớp chính xác 100%.
   - **Tên riêng**, từ viết tắt, mã môn học, tên quy chuẩn hiếm gặp.
   - Khi embedding provider chưa sẵn sàng hoặc gặp sự cố mạng/hạn mức, keyword search trên Postgres vẫn chạy ổn định (zero external dependency).
5. **Chuẩn hoá điểm `score`**:
   `ts_rank` không có trần trên cố định (giá trị phụ thuộc vào tần suất từ xuất hiện trong chunk). Chuẩn hoá về thang đo $[0, 1]$ thông qua hàm đơn điệu:
   $$\text{score} = \frac{\text{rank}}{\text{rank} + 1}$$
   - Đảm bảo $\text{score} \in [0, 1)$, $\text{rank} = 0 \Rightarrow \text{score} = 0$.
   - Giữ nguyên thứ tự xếp hạng (rank cao $\Rightarrow$ score cao).
   - Dễ dàng hợp nhất với điểm cosine similarity của Vector Retriever qua thuật toán Fusion (RRF / Weighted).
6. **Xử lý query đặc biệt**:
   Nếu câu query rỗng hoặc toàn ký tự đặc biệt (không chứa ký tự chữ/số nào), service trả về ngay `emptyResult({ reason: 'empty_tsquery' })` mà không cần gọi database.


## Graph retrieval (PHASE 6)

`GraphRetrieverService` (implement `Retriever`, `source='graph'`) — chỉ hoạt động
khi `GRAPH_RAG_ENABLED=true`. Luồng (graph-rag.md §4):

1. **Entity linking** (`GraphEntityLinkerService`, 3 tầng, dừng ở tầng đầu có kết quả):
   1. **substring** — tên `Entity` là chuỗi con (chuẩn hoá) của query. Rẻ, không LLM.
   2. alias (`EntityAlias`) — **hoãn** (chưa có bảng).
   3. **LLM** (`GRAPH_LINK_USE_LLM=true`) — rút danh sách thực thể từ query bằng
      structured output, khớp lại `toLower(Entity.name)`.
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
- Score hợp nhất chuẩn hoá lại về [0,1] (chia cho đỉnh) để đồng nhất với
  `ContextValidator`.

`RetrievalService` chạy các retriever của `strategy` **song song** (`Promise.all`);
chỉ set `error` toàn cục (→ 502) khi **mọi** nguồn được chọn đều lỗi hạ tầng.

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

Query có JOIN + `WHERE e.model = ... AND d.status = ...` có thể khiến planner
**không dùng HNSW index** (HNSW scan chỉ kích hoạt khi
`ORDER BY embedding <op> const LIMIT k` là thao tác chủ đạo, không bị filter
chặn trước). Với corpus lớn cần: (a) partial index theo model, (b) materialize
"chunk của document COMPLETED" hoặc (c) đẩy filter sau top-k. Đo bằng
`EXPLAIN ANALYZE` khi corpus vượt ~50k chunk.
