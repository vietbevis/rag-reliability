-- PHASE 9: citation cấp claim.
-- (Các dòng DROP INDEX / DROP DEFAULT do Prisma sinh cho cột Unsupported
--  `contentTsv` (tsvector generated) và index HNSW `Embedding_embedding_hnsw_cosine_idx`
--  đã bị loại bỏ — Prisma không mô hình hoá được các đối tượng này, chúng vẫn cần tồn tại.)

-- AlterTable
ALTER TABLE "Citation" ADD COLUMN     "claimId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'chunk',
ADD COLUMN     "relationType" TEXT,
ADD COLUMN     "sourceEntity" TEXT,
ADD COLUMN     "targetEntity" TEXT;

-- AlterTable
ALTER TABLE "RagQuery" ADD COLUMN     "claims" JSONB NOT NULL DEFAULT '[]';
