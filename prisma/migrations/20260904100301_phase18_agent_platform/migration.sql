-- PHASE 18 — Agent Reliability Platform: failure taxonomy + provider trace.
-- (Đã tỉa DROP INDEX / ALTER contentTsv do schema-drift lịch sử — xem
-- migration phase17_agent_run.)

-- AlterTable: phân loại lý do fail của agent run (PROMPT §32)
ALTER TABLE "AgentRun" ADD COLUMN "failureClass" TEXT,
ADD COLUMN "failureDetail" TEXT;

-- AlterTable: provider cung cấp tool cho từng step (trace phân biệt nguồn lỗi)
ALTER TABLE "AgentStep" ADD COLUMN "providerId" TEXT;
