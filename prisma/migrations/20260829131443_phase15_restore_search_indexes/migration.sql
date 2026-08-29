-- PHASE 15: khôi phục các index tìm kiếm do SQL migration quản lý tay.
--
-- Một số DB dev (và có thể cả prod nếu từng chạy `prisma migrate dev` với
-- drift-reconcile) đã MẤT hai index này — Prisma không theo dõi được
-- `Unsupported("vector")` / `Unsupported("tsvector")` nên autogen hay sinh
-- `DROP INDEX` cho chúng. Hậu quả: vector search + keyword search quét tuần tự
-- (VectorSchemaService cảnh báo lúc khởi động).
--
-- `IF NOT EXISTS` → idempotent: no-op trên DB đã có đủ index.
-- Lưu ý vận hành: trên bảng lớn, `CREATE INDEX` (không CONCURRENTLY) khoá ghi
-- trong lúc build. Corpus hiện ở quy mô nhỏ nên chấp nhận được; nếu bảng lớn,
-- chạy tay `CREATE INDEX CONCURRENTLY` tương ứng trước rồi `migrate resolve`.

-- ANN index cho pgvector (Embedding.embedding = vector(1024), cosine).
-- Toán tử truy vấn tương ứng: `<=>` (VectorSchemaService.distanceOperator).
CREATE INDEX IF NOT EXISTS "Embedding_embedding_hnsw_cosine_idx"
  ON "Embedding"
  USING hnsw ("embedding" vector_cosine_ops);

-- GIN index cho cột generated tsvector (keyword retrieval — PHASE 6).
CREATE INDEX IF NOT EXISTS "DocumentChunk_contentTsv_idx"
  ON "DocumentChunk"
  USING GIN ("contentTsv");
