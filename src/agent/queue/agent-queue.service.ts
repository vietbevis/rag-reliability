import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { AgentRunStatus } from '../../generated/prisma/client';
import {
  AgentService,
  type AgentRunResult,
  type AgentServiceRunOptions,
} from '../agent.service';
import {
  AGENT_RUN_QUEUE,
  RUN_AGENT_JOB,
  type RunAgentJobData,
} from './agent-queue.constants';

export interface AgentSubmitResult {
  /** Có khi chạy đồng bộ (execution='sync' hoặc queue tắt). */
  result?: AgentRunResult;
  /** Có khi đẩy vào queue (202). */
  queued?: { id: string; status: AgentRunStatus };
}

/**
 * Điều phối thực thi agent (PHASE 17.8): `sync` chạy ngay + trả full result;
 * `async` (khi queue bật) tạo `AgentRun` + đẩy job BullMQ, trả 202; `async` khi
 * queue tắt ⇒ fallback chạy sync (như document queue).
 *
 * Agent run KHÔNG retry tự động (`attempts: 1`): mỗi lần chạy tốn nhiều LLM call
 * và không tất định — retry mù dễ nhân đôi chi phí.
 */
@Injectable()
export class AgentQueueService {
  private readonly logger = new Logger(AgentQueueService.name);
  private readonly queueCfg: AppConfig['queue'];

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly agent: AgentService,
    @Optional()
    @InjectQueue(AGENT_RUN_QUEUE)
    private readonly queue?: Queue<RunAgentJobData>,
  ) {
    this.queueCfg = config.get('queue', { infer: true });
  }

  get enabled(): boolean {
    return this.queueCfg.enabled && !!this.queue;
  }

  async submit(
    task: string,
    opts: AgentServiceRunOptions,
    execution: 'sync' | 'async',
  ): Promise<AgentSubmitResult> {
    if (execution === 'sync' || !this.enabled) {
      if (execution === 'async' && !this.enabled) {
        this.logger.warn('execution=async nhưng queue tắt — chạy đồng bộ');
      }
      return { result: await this.agent.run(task, opts) };
    }

    const { id } = await this.agent.create(task, opts);
    await this.queue!.add(
      RUN_AGENT_JOB,
      {
        agentRunId: id,
        task,
        toolAllowlist: opts.toolAllowlist,
        costBudgetUsd: opts.costBudgetUsd,
      },
      {
        jobId: id,
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    this.logger.log(`agent run ${id} đã đẩy vào queue`);
    return { queued: { id, status: AgentRunStatus.RUNNING } };
  }
}
