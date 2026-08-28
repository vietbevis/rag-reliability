-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PARSING', 'CLEANING', 'VALIDATING', 'CHUNKING', 'EMBEDDING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ParserType" AS ENUM ('ANYDOC', 'PLAINTEXT', 'HTML', 'FALLBACK');

-- CreateEnum
CREATE TYPE "IngestionStage" AS ENUM ('PARSE', 'CLEAN', 'NORMALIZE', 'DEDUPLICATE', 'QUALITY', 'CHUNK', 'EMBED', 'STORE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RagStatus" AS ENUM ('GROUNDED', 'PARTIALLY_GROUNDED', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE');

-- CreateEnum
CREATE TYPE "EvaluationCaseType" AS ENUM ('DIRECT_RETRIEVAL', 'MULTI_HOP', 'UNANSWERABLE', 'ADVERSARIAL', 'CONFLICTING_SOURCES', 'EXACT_IDENTIFIER', 'SEMANTIC_QUERY');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "parserUsed" "ParserType",
    "rawText" TEXT,
    "cleanedText" TEXT,
    "parsedMarkdown" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "qualityReport" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "heading" TEXT,
    "section" TEXT,
    "page" INTEGER,
    "qualityScore" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "stage" "IngestionStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagQuery" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" "RagStatus",
    "answer" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "faithfulness" DOUBLE PRECISION,
    "usage" JSONB NOT NULL DEFAULT '{}',
    "trace" JSONB NOT NULL DEFAULT '{}',
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalLog" (
    "id" TEXT NOT NULL,
    "ragQueryId" TEXT,
    "query" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "topK" INTEGER NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "results" JSONB NOT NULL DEFAULT '[]',
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetrievalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "ragQueryId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "documentId" TEXT,
    "chunkId" TEXT,
    "page" INTEGER,
    "section" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationDataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCase" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "EvaluationCaseType" NOT NULL,
    "question" TEXT NOT NULL,
    "answerable" BOOLEAN NOT NULL,
    "expectedAnswer" TEXT,
    "expectedDocuments" JSONB NOT NULL DEFAULT '[]',
    "expectedChunks" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT,
    "model" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "actualAnswer" TEXT,
    "actualStatus" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "failureLayer" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_mimeType_idx" ON "Document"("mimeType");

-- CreateIndex
CREATE UNIQUE INDEX "Document_checksum_version_key" ON "Document"("checksum", "version");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "DocumentChunk_contentHash_idx" ON "DocumentChunk"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_sequence_key" ON "DocumentChunk"("documentId", "sequence");

-- CreateIndex
CREATE INDEX "Embedding_provider_model_idx" ON "Embedding"("provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_chunkId_model_key" ON "Embedding"("chunkId", "model");

-- CreateIndex
CREATE INDEX "IngestionJob_documentId_stage_idx" ON "IngestionJob"("documentId", "stage");

-- CreateIndex
CREATE INDEX "IngestionJob_status_idx" ON "IngestionJob"("status");

-- CreateIndex
CREATE INDEX "RagQuery_status_idx" ON "RagQuery"("status");

-- CreateIndex
CREATE INDEX "RagQuery_createdAt_idx" ON "RagQuery"("createdAt");

-- CreateIndex
CREATE INDEX "RetrievalLog_ragQueryId_idx" ON "RetrievalLog"("ragQueryId");

-- CreateIndex
CREATE INDEX "RetrievalLog_createdAt_idx" ON "RetrievalLog"("createdAt");

-- CreateIndex
CREATE INDEX "Citation_ragQueryId_idx" ON "Citation"("ragQueryId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationDataset_name_key" ON "EvaluationDataset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCase_datasetId_externalId_key" ON "EvaluationCase"("datasetId", "externalId");

-- CreateIndex
CREATE INDEX "EvaluationRun_datasetId_idx" ON "EvaluationRun"("datasetId");

-- CreateIndex
CREATE INDEX "EvaluationRun_isBaseline_idx" ON "EvaluationRun"("isBaseline");

-- CreateIndex
CREATE INDEX "EvaluationResult_runId_idx" ON "EvaluationResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_runId_caseId_key" ON "EvaluationResult"("runId", "caseId");

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalLog" ADD CONSTRAINT "RetrievalLog_ragQueryId_fkey" FOREIGN KEY ("ragQueryId") REFERENCES "RagQuery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_ragQueryId_fkey" FOREIGN KEY ("ragQueryId") REFERENCES "RagQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvaluationDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "EvaluationDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvaluationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
