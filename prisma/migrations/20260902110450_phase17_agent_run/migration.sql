-- PHASE 17 — Agent tool-calling: AgentRun + AgentStep.
-- (Các dòng DROP INDEX / ALTER COLUMN mà Prisma sinh cho contentTsv_idx và
--  Embedding_embedding_hnsw_cosine_idx đã được BỎ — hai index đó do migration
--  raw phase15/phase16 quản lý, không phải drift.)

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ABSTAINED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentStepType" AS ENUM ('THINK', 'TOOL_CALL', 'TOOL_RESULT', 'FINAL', 'GUARD_STOP');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "finalStatus" "RagStatus",
    "stopReason" TEXT,
    "answer" TEXT,
    "toolAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costBudgetUsd" DOUBLE PRECISION NOT NULL,
    "usage" JSONB NOT NULL DEFAULT '{}',
    "claims" JSONB NOT NULL DEFAULT '[]',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "faithfulness" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL DEFAULT '{}',
    "checkpointId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "AgentStepType" NOT NULL,
    "toolName" TEXT,
    "toolInput" JSONB,
    "toolOutput" JSONB,
    "evidence" JSONB,
    "tokens" JSONB,
    "latencyMs" INTEGER,
    "note" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentRun_finalStatus_idx" ON "AgentRun"("finalStatus");

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- CreateIndex
CREATE INDEX "AgentStep_agentRunId_idx" ON "AgentStep"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_agentRunId_index_key" ON "AgentStep"("agentRunId", "index");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
