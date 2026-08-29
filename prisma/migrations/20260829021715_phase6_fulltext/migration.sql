-- PHASE 6: Keyword retrieval / PostgreSQL full-text search index (PROMPT §17).
-- Lưu ý: KHÔNG đụng tới index HNSW `Embedding_embedding_hnsw_cosine_idx`
-- (cột `Unsupported("vector")` + index do migration phase-3 quản lý tay).
-- Config 'simple' vì Postgres không có bộ phân tích tiếng Việt sẵn — 'simple' vẫn
-- tokenize + lowercase, đủ cho keyword/mã văn bản/tên riêng (PROMPT §17).

CREATE INDEX IF NOT EXISTS "DocumentChunk_content_fts_idx"
  ON "DocumentChunk" USING GIN (to_tsvector('simple', "content"));
