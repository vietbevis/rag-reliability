-- PHASE 3: cột vector có số chiều cố định + ANN index (PROMPT §15).
--
-- Số chiều mặc định = 1536 (OpenAI text-embedding-3-small, cũng là
-- EMBEDDING_DIMENSION mặc định). Đổi sang model khác số chiều (vd Gemini
-- text-embedding-004 = 768) => cần migration mới thay 1536 ở cả hai câu dưới
-- (xem docs/rag/embedding.md). App sẽ CẢNH BÁO lúc khởi động nếu
-- EMBEDDING_DIMENSION không khớp số chiều cột này.
--
-- Index: HNSW với vector_cosine_ops — chuẩn cho embedding đã normalize
-- (OpenAI/Gemini/fake đều normalize). Toán tử truy vấn tương ứng: `<=>`.
-- Trade-off HNSW: build chậm + tốn RAM hơn ivfflat, nhưng recall/tốc độ query
-- tốt hơn và không cần chọn `lists`. Phù hợp corpus vừa và nhỏ ở giai đoạn này.

ALTER TABLE "Embedding"
  ALTER COLUMN "embedding" TYPE vector(1536);

CREATE INDEX IF NOT EXISTS "Embedding_embedding_hnsw_cosine_idx"
  ON "Embedding"
  USING hnsw ("embedding" vector_cosine_ops);
