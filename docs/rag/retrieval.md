# Retrieval (PHASE 4 · vector; PHASE 6 · keyword + graph + hybrid)

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

## API

### `POST /rag/search` — chỉ retrieval, KHÔNG gọi LLM (§40)

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
