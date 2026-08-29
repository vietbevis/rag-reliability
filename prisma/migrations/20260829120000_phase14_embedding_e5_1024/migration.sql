-- PHASE 14: chuyển pgvector sang 1024 chiều cho intfloat/multilingual-e5-large.
--
-- Lý do (docs/audit/EXECUTIVE_SUMMARY.md §10.4, RETRIEVAL_BENCHMARK): cột
-- vector(1536) bị gán cứng, chặn việc dùng model embedding đa ngôn ngữ mã nguồn
-- mở. E5-large (1024d) cho chất lượng tiếng Việt tốt hơn, self-hosted, $0/query.
--
-- Embedding là DỮ LIỆU DẪN XUẤT từ DocumentChunk. Migration này xoá sạch bảng
-- Embedding và đưa các document đã hoàn tất về CHUNKING để re-embed qua
-- `POST /documents/:id/embed` (hoặc chạy lại seed). KHÔNG mất dữ liệu gốc.
--
-- E5 yêu cầu tiền tố bất đối xứng: đặt trong .env
--   EMBEDDING_DIMENSION=1024
--   EMBEDDING_QUERY_PREFIX="query: "
--   EMBEDDING_PASSAGE_PREFIX="passage: "
-- (EmbeddingService tự suy ra "query: "/"passage: " nếu tên model chứa "e5").

DROP INDEX IF EXISTS "Embedding_embedding_hnsw_cosine_idx";

TRUNCATE TABLE "Embedding";

ALTER TABLE "Embedding"
  ALTER COLUMN "embedding" TYPE vector(1024);

CREATE INDEX IF NOT EXISTS "Embedding_embedding_hnsw_cosine_idx"
  ON "Embedding"
  USING hnsw ("embedding" vector_cosine_ops);

-- Đưa document đã có chunk nhưng embedding vừa bị xoá về CHUNKING để re-embed.
UPDATE "Document"
SET "status" = 'CHUNKING'
WHERE "status" IN ('COMPLETED', 'GRAPHING')
  AND EXISTS (
    SELECT 1 FROM "DocumentChunk" c WHERE c."documentId" = "Document"."id"
  );

-- FK index cho Citation (docs/audit/DATABASE_REVIEW.md §3.1) — tránh seq scan
-- trên Citation khi xoá Document/DocumentChunk.
CREATE INDEX IF NOT EXISTS "Citation_documentId_idx" ON "Citation"("documentId");
CREATE INDEX IF NOT EXISTS "Citation_chunkId_idx" ON "Citation"("chunkId");
