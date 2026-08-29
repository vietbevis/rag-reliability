-- PHASE 5: Graph RAG construction.
-- Lưu ý: KHÔNG đụng tới index HNSW `Embedding_embedding_hnsw_cosine_idx`
-- (cột `Unsupported("vector")` + index do migration phase-3 quản lý tay).

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'GRAPHING';

-- AlterEnum
ALTER TYPE "IngestionStage" ADD VALUE 'GRAPH';

-- CreateTable
CREATE TABLE "GraphExtractionCache" (
    "chunkHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "entities" JSONB NOT NULL DEFAULT '[]',
    "relationships" JSONB NOT NULL DEFAULT '[]',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphExtractionCache_pkey" PRIMARY KEY ("chunkHash","model","promptVersion")
);
