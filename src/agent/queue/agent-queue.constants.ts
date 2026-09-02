/** Queue BullMQ cho agent run chạy nền (PHASE 17.8). */
export const AGENT_RUN_QUEUE = 'agent-run';

export const RUN_AGENT_JOB = 'run-agent';

export interface RunAgentJobData {
  agentRunId: string;
  task: string;
  toolAllowlist?: string[];
  costBudgetUsd?: number;
}

/**
 * `QUEUE_ENABLED` đọc ở đây (lúc dựng cây module, sớm hơn ConfigModule) — quyết
 * định có nạp BullModule + worker hay không. Test set `QUEUE_ENABLED='false'`.
 */
export function agentQueueEnabled(): boolean {
  const v = process.env.QUEUE_ENABLED;
  return v === undefined || v === 'true' || v === '1';
}
