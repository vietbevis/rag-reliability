-- PHASE 19: chuyển toàn bộ runtime sang Ollama local.
--
-- Embedding chuyển từ `zylonai/multilingual-e5-large` sang
-- `Qwen3-Embedding-0.6B` (mặc định) — cùng 1024 chiều nên KHÔNG đổi kiểu cột,
-- KHÔNG rebuild HNSW index. Nhưng `@@unique([chunkId, model])` ⇒ vector cũ trở
-- thành mồ côi và trộn hai không gian vector khác model trong cùng một HNSW
-- index ⇒ phải xoá sạch và re-embed.
--
-- Embedding là DỮ LIỆU DẪN XUẤT từ DocumentChunk — TRUNCATE không mất dữ liệu
-- gốc. Đưa Document đã hoàn tất về CHUNKING để re-embed qua
-- `POST /documents/:id/embed` (hoặc chạy lại seed eval).
--
-- .env sau migration:
--   CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
--   CUSTOM_LLM_MODEL=qwen3:8b
--   CUSTOM_EMBEDDING_MODEL=Qwen3-Embedding-0.6B   (hoặc bge-m3)
--   RERANK_PROVIDER=api / RERANK_BASE_URL=http://localhost:11435/v1
-- EmbeddingService tự thêm instruction "Instruct: …\nQuery: " cho query khi tên
-- model khớp /qwen3.*embed/i (bge-m3 không cần tiền tố).

TRUNCATE TABLE "Embedding";

UPDATE "Document"
SET "status" = 'CHUNKING'
WHERE "status" IN ('COMPLETED', 'GRAPHING')
  AND EXISTS (
    SELECT 1 FROM "DocumentChunk" c WHERE c."documentId" = "Document"."id"
  );
