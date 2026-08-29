-- PHASE 16: khai báo TƯỜNG MINH tham số build HNSW cho "Embedding".embedding
-- (theo Supabase / pgvector production playbook).
--
-- pgvector mặc định: m = 16, ef_construction = 64. Với vector 1024 chiều
-- (intfloat/multilingual-e5-large) nâng ef_construction lên 128 cho recall tốt
-- hơn rõ rệt khi corpus lớn; đổi lại thời gian build index tăng (chấp nhận được
-- ở quy mô hiện tại). m giữ 16. Truy vấn vẫn dùng toán tử `<=>`
-- (VectorSchemaService.distanceOperator, EMBEDDING_DISTANCE=cosine).
--
-- Tinh chỉnh lúc QUERY (hnsw.ef_search / hnsw.iterative_scan) do ứng dụng đặt
-- bằng `SET LOCAL` trong VectorRetrieverService — xem RETRIEVAL_HNSW_* trong .env.
--
-- ⚠️ LƯU Ý VẬN HÀNH — bảng lớn:
--   `CREATE INDEX` (không CONCURRENTLY) KHOÁ GHI bảng "Embedding" trong lúc
--   build. Migration chạy trong transaction nên KHÔNG dùng được CONCURRENTLY.
--   Trên bảng > ~100k dòng, ĐỪNG để migration này build — làm thủ công TRƯỚC:
--
--     SET maintenance_work_mem = '2GB';
--     SET max_parallel_maintenance_workers = 7;
--     DROP INDEX IF EXISTS "Embedding_embedding_hnsw_cosine_idx";
--     CREATE INDEX CONCURRENTLY "Embedding_embedding_hnsw_cosine_idx"
--       ON "Embedding" USING hnsw ("embedding" vector_cosine_ops)
--       WITH (m = 16, ef_construction = 128);
--
--   rồi đánh dấu migration đã áp:
--     npx prisma migrate resolve --applied 20260830004012_phase16_hnsw_index_params

SET maintenance_work_mem = '512MB';
SET max_parallel_maintenance_workers = 4;

DROP INDEX IF EXISTS "Embedding_embedding_hnsw_cosine_idx";

CREATE INDEX "Embedding_embedding_hnsw_cosine_idx"
  ON "Embedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
