# Embedding & pgvector (PHASE 3)

## Vấn đề

Embedding là bước bản lề: chất lượng vector quyết định retrieval kéo về đúng
hay sai, và mọi bước sau (rerank, grounding, faithfulness) đều vô nghĩa nếu
chunk lấy về không liên quan. Ba thứ **phải nhất quán** với nhau, nếu lệch là
hỏng âm thầm (PROMPT §14, §15):

- **số chiều** (dimension) của model ↔ số chiều cột `vector(N)` trong DB
- **metric khoảng cách** (cosine / l2 / ip) ↔ loại ANN index đã tạo
- **provider/model** ghi rõ trên từng bộ embedding để so sánh và tái tạo

## Provider abstraction (PROMPT §14)

Interface `EmbeddingProvider` (`embed`, `embedBatch`, `dimensions`,
`isConfigured`) — RAG core không bao giờ tham chiếu provider cụ thể. Đổi bằng
`EMBEDDING_PROVIDER`, không sửa code.

| Provider | Model mặc định             | Ghi chú                               |
| -------- | -------------------------- | ------------------------------------- |
| `openai` | `text-embedding-3-small`   | 1536 chiều; hỗ trợ `dimensions` param |
| `gemini` | `text-embedding-004`       | 768 chiều                             |
| `custom` | endpoint OpenAI-compatible | tuỳ model                             |
| `fake`   | `fake-deterministic-v1`    | **CHỈ CI/dev** — xem dưới             |

- **Batch**: `EmbeddingService.embedBatch` chia lô theo `EMBEDDING_BATCH_SIZE`
  (mặc định 96) — không bao giờ gọi API từng chunk (PROMPT §55).
- **Retry / timeout / phân loại lỗi**: dùng chung `withRetry` +
  `classifyProviderError` với LLM layer (exponential backoff + jitter, giới hạn
  lần thử — PROMPT §52).
- **Kiểm tra số chiều**: `BaseLangChainEmbeddingProvider` verify độ dài vector
  trả về == `EMBEDDING_DIMENSION`, lệch là ném lỗi rõ ràng.
- **Cost/token**: `EmbeddingResult.usage` (token ước tính, `estimatedCost`
  per-provider). `fake` = 0.

### Provider `fake`

Vector **tất định**: PRNG (xoshiro128) seed bằng `sha256(text)` → chuẩn hoá về
đơn vị (L2 norm = 1). Cùng text luôn cho cùng vector; text khác cho vector
khác — **chỉ vậy, không có ý nghĩa ngữ nghĩa**. Mục đích: chạy được toàn bộ
pipeline (tới `COMPLETED`) và test retrieval trong CI mà không cần API key
(PROMPT §42). Không dùng cho production.

## pgvector (PROMPT §15)

Prisma không có kiểu `vector` native → cột `Embedding.embedding` khai báo
`Unsupported("vector")`; mọi ghi/đọc vector qua `$executeRaw` / `$queryRaw`.

| Thuộc tính | Giá trị mặc định         | Vì sao                                                              |
| ---------- | ------------------------ | ------------------------------------------------------------------- |
| dimension  | `vector(1536)`           | OpenAI `text-embedding-3-small` = `EMBEDDING_DIMENSION` mặc định    |
| metric     | cosine (`<=>`)           | chuẩn cho embedding đã normalize (OpenAI/Gemini/fake đều normalize) |
| index      | HNSW `vector_cosine_ops` | recall/tốc độ query tốt, không cần chọn tham số `lists`             |

**HNSW vs IVFFlat**: HNSW build chậm hơn và tốn RAM hơn, nhưng recall + tốc độ
truy vấn tốt hơn và không phải đoán `lists` (IVFFlat cần `lists ≈ rows/1000` và
phải rebuild khi corpus lớn lên). Với corpus vừa/nhỏ ở giai đoạn này, HNSW là
lựa chọn an toàn. Có thể benchmark đổi sang IVFFlat ở PHASE sau nếu build-time
thành vấn đề.

Migration: `prisma/migrations/*_phase3_embedding_index/migration.sql` —
`ALTER COLUMN embedding TYPE vector(1536)` + `CREATE INDEX ... USING hnsw`.
Đây là SQL migration có kiểm soát (PROMPT §51), không phải `db push`.

### Đổi số chiều (vd sang Gemini 768)

1. Viết **migration mới**: `ALTER COLUMN "embedding" TYPE vector(768)` +
   `DROP INDEX ...; CREATE INDEX ... vector_cosine_ops` (index cần số chiều cố
   định nên phải tạo lại).
2. Đặt `EMBEDDING_DIMENSION=768`, `EMBEDDING_PROVIDER=gemini`.
3. Re-embed toàn bộ (`POST /documents/:id/embed`) — vector cũ 1536 chiều không
   dùng được với cột 768.

`VectorSchemaService` **cảnh báo lúc khởi động** nếu `EMBEDDING_DIMENSION` /
`EMBEDDING_DISTANCE` không khớp cột/index thực tế (chỉ log WARNING, không tự
sửa). `ChunkEmbeddingService` **từ chối ghi** khi số chiều provider ≠ số chiều
cột — báo `IngestionError` rõ ràng thay vì ghi vector hỏng.

> Nếu cột dạng `vector` không số chiều (`atttypmod < 0`), việc kiểm tra được bỏ
> qua (không xác minh được) — nhưng lúc đó cũng không tạo được ANN index.

## Pipeline (`chunk-embedding.service.ts`)

```
embedDocument(documentId, providerOverride?)
  guard: doc.status ∈ {CHUNKING, EMBEDDING, COMPLETED}
  provider chưa cấu hình -> return { skipped: true, reason }   (không đổi status)
  load chunks (theo sequence)
  verify provider.dimensions == số chiều cột DB
  status -> EMBEDDING
  embedBatch(chunk.content[])                     (chia lô EMBEDDING_BATCH_SIZE)
  verify vectors.length == chunks.length
  $transaction:
    DELETE Embedding WHERE chunkId IN (...) AND model = <model>
    INSERT INTO "Embedding" (...) VALUES ...       (multi-row, batch 100)
       — id: randomUUID; embedding: '[...]'::vector (giá trị là bound param)
    UPDATE Document status -> COMPLETED
    INSERT IngestionJob stage=EMBED
```

`IngestionJob.metrics` (stage `EMBED`):
`{ provider, model, dimensions, chunkCount, inputTokens, estimatedCost, ms }`.

`@@unique([chunkId, model])` → nhiều model embedding có thể cùng tồn tại trên
một chunk (phục vụ benchmark model — xem dưới). Re-embed cùng model = xoá rồi
ghi lại.

## Trạng thái

```
... VALIDATING → CHUNKING → EMBEDDING → COMPLETED
```

- Provider embedding **chưa cấu hình** → bỏ qua êm, document dừng ở `CHUNKING`;
  chạy `POST /documents/:id/embed` sau khi cấu hình key.
- `$transaction` lỗi giữa chừng → document giữ `EMBEDDING`, chưa có vector nào
  (insert nằm trong transaction, all-or-nothing) → re-embed được.

## API

| Endpoint                                               | Việc                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `POST /documents`                                      | auto: ingest → chunk → **embed** (nếu provider cấu hình) → `COMPLETED` |
| `POST /documents/:id/embed` `{ "provider": "gemini" }` | (re-)embed; chọn provider để benchmark model                           |
| `GET /documents/:id/embeddings`                        | tóm tắt `{ total, byModel: [{ provider, model, dimensions, count }] }` |

## Failure modes (PROMPT §54)

| Tình huống                       | Kết quả                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| Provider chưa cấu hình           | `{ skipped: true }`, document dừng ở `CHUNKING`                  |
| Số chiều provider ≠ cột DB       | `IngestionError('INGESTION_PRECONDITION')`, không ghi            |
| Provider trả sai số lượng vector | `IngestionError('INGESTION_FAILED')`                             |
| Provider API lỗi tạm thời        | retry có giới hạn → ném; document giữ `EMBEDDING`, re-embed được |
| Chưa có ANN index                | vector search chạy sequential scan (chậm) + WARNING lúc boot     |

## Benchmark — so sánh embedding model (PROMPT §12, §36)

Nhờ `@@unique([chunkId, model])`, có thể tạo nhiều bộ embedding song song trên
cùng corpus:

```
POST /documents/:id/embed { "provider": "openai" }   # text-embedding-3-small
POST /documents/:id/embed { "provider": "gemini" }   # text-embedding-004
```

Rồi chạy golden dataset với từng bộ, so **Recall@K / MRR / NDCG / Context
Precision** + **cost** + **latency** + **dimension** (dimension cao hơn =
storage + query chậm hơn). Ghi rõ provider + model trong mỗi experiment.
