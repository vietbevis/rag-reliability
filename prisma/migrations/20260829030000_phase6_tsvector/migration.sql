-- PHASE 6: cột generated tsvector cho keyword retrieval — tránh tính
-- to_tsvector('simple', content) HAI lần (SELECT ts_rank + WHERE @@) trên mỗi
-- row, và dùng GIN index trực tiếp trên cột.
-- Lưu ý: KHÔNG đụng index HNSW của Embedding (do migration phase-3 quản lý tay).

ALTER TABLE "DocumentChunk"
  ADD COLUMN "contentTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;

CREATE INDEX IF NOT EXISTS "DocumentChunk_contentTsv_idx"
  ON "DocumentChunk" USING GIN ("contentTsv");

-- Thay index biểu thức của migration phase6_fulltext (giờ đã có cột).
DROP INDEX IF EXISTS "DocumentChunk_content_fts_idx";
