import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { AgentRunStatus } from '../../generated/prisma/client';
import { AgentService } from '../agent.service';
import { AGENT_RUN_QUEUE, type RunAgentJobData } from './agent-queue.constants';

/**
 * Worker BullMQ cho agent run nền (PHASE 17.8). `AgentRun` đã được tạo (RUNNING)
 * lúc enqueue; ở đây chỉ chạy graph + persist qua {@link AgentService.execute}.
 * Không retry (`attempts: 1`); job lỗi ⇒ đưa run về FAILED.
 */
@Processor(AGENT_RUN_QUEUE, {
  concurrency: Number(process.env.QUEUE_CONCURRENCY ?? 1),
})
export class AgentRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor(
    private readonly agent: AgentService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<RunAgentJobData>): Promise<{ status: string }> {
    const { agentRunId, task, toolAllowlist, costBudgetUsd } = job.data;
    this.logger.log(`Job ${job.id} chạy agent run ${agentRunId}`);
    const res = await this.agent.execute(agentRunId, task, {
      toolAllowlist,
      costBudgetUsd,
    });
    return { status: res.status };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RunAgentJobData>, err: Error): Promise<void> {
    this.logger.error(`Job ${job.id} lỗi: ${err.message}`);
    await this.prisma.agentRun
      .update({
        where: { id: job.data.agentRunId },
        data: { status: AgentRunStatus.FAILED, error: err.message },
      })
      .catch(() => undefined);
  }
}
