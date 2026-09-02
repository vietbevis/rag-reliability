import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { sanitizeTrace } from '../common/observability/trace-sanitizer.util';
import type {
  FaithfulnessResult,
  RagStatus,
  VerifiedClaim,
} from '../common/types';
import {
  AgentRunStatus,
  AgentStepType,
  Prisma,
  RagStatus as RagStatusEnum,
} from '../generated/prisma/client';
import {
  AgentGraphBuilder,
  type AgentRunOutcome,
} from './graph/agent-graph.builder';
import type { AgentCitation, AgentUsage } from './graph/agent-state';
import { LangfuseTracer } from './observability/langfuse.tracer';

export interface AgentServiceRunOptions {
  toolAllowlist?: string[];
  costBudgetUsd?: number;
}

export interface AgentRunResult {
  id: string;
  task: string;
  status: AgentRunStatus;
  finalStatus: RagStatus | null;
  stopReason: string;
  answer: string | null;
  citations: AgentCitation[];
  claims: VerifiedClaim[];
  faithfulness: FaithfulnessResult | null;
  usage: AgentUsage;
  toolCallCount: number;
  stepCount: number;
  latencyMs: number;
  error?: string;
}

function asJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return v;
}

/**
 * Điểm vào của agent (PHASE 17 §11): tạo `AgentRun`, chạy graph, persist
 * trajectory + kết quả. Route HTTP + rate-limit + gate `AGENT_ENABLED` ở
 * `AgentController`; service này luôn chạy được (dùng bởi test/eval/worker).
 *
 * 17.8: `create` + `execute` tách rời (async BullMQ); `cancel` abort run đang
 * chạy TRONG CÙNG process (worker/sync). Đa-node: `cancel` vẫn set CANCELLED,
 * worker node khác không bị abort ngay (giới hạn đã biết).
 */
@Injectable()
export class AgentService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private readonly defaultBudget: number;
  /** Run đang chạy trong process này → AbortController để cancel. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: AgentGraphBuilder,
    private readonly langfuse: LangfuseTracer,
    config: ConfigService<AppConfig, true>,
  ) {
    this.defaultBudget = config.get('agent', {
      infer: true,
    }).limits.costBudgetUsd;
  }

  onModuleDestroy(): void {
    for (const ac of this.running.values()) ac.abort();
  }

  /** Tạo bản ghi `AgentRun` (RUNNING) — chưa chạy graph. Dùng cho async. */
  async create(
    task: string,
    opts: AgentServiceRunOptions = {},
  ): Promise<{ id: string }> {
    return this.prisma.agentRun.create({
      data: {
        task,
        toolAllowlist: opts.toolAllowlist ?? [],
        costBudgetUsd: opts.costBudgetUsd ?? this.defaultBudget,
      },
      select: { id: true },
    });
  }

  /** Tạo + chạy đồng bộ (sync HTTP, test, eval). */
  async run(
    task: string,
    opts: AgentServiceRunOptions = {},
  ): Promise<AgentRunResult> {
    const { id } = await this.create(task, opts);
    return this.execute(id, task, opts);
  }

  /**
   * Chạy graph cho một `AgentRun` đã tồn tại + persist. Gọi bởi `run` (sync) và
   * bởi worker BullMQ (async).
   */
  async execute(
    agentRunId: string,
    task: string,
    opts: AgentServiceRunOptions = {},
  ): Promise<AgentRunResult> {
    const ac = new AbortController();
    this.running.set(agentRunId, ac);

    let outcome: AgentRunOutcome;
    try {
      outcome = await this.graph.run(task, {
        agentRunId,
        toolAllowlist: opts.toolAllowlist,
        costBudgetUsd: opts.costBudgetUsd,
        signal: ac.signal,
      });
    } finally {
      this.running.delete(agentRunId);
    }

    const run = { id: agentRunId };
    const status = mapStatus(outcome);
    const trace = sanitizeTrace(buildTrace(outcome));

    await this.prisma.$transaction([
      this.prisma.agentStep.createMany({
        data: outcome.steps.map((s) => ({
          agentRunId: run.id,
          index: s.index,
          type: AgentStepType[s.type],
          toolName: s.toolName ?? null,
          toolInput: asJson(s.toolInput),
          toolOutput: asJson(s.toolOutput),
          evidence: asJson(s.evidence),
          tokens: asJson(s.tokens),
          latencyMs: s.latencyMs ?? null,
          note: s.note ?? null,
          error: s.error ?? null,
        })),
      }),
      this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status,
          finalStatus: outcome.finalStatus
            ? RagStatusEnum[outcome.finalStatus]
            : null,
          stopReason: outcome.stopReason,
          answer: outcome.answer,
          usage: outcome.usage as unknown as Prisma.InputJsonValue,
          claims: outcome.claims as unknown as Prisma.InputJsonValue,
          citations: outcome.citations as unknown as Prisma.InputJsonValue,
          faithfulness: outcome.faithfulness?.score ?? null,
          latencyMs: outcome.latencyMs,
          stepCount: outcome.steps.length,
          trace: trace as Prisma.InputJsonValue,
          error: outcome.error ?? null,
        },
      }),
    ]);

    this.logger.log(
      `agent run ${run.id}: ${status} · finalStatus=${outcome.finalStatus ?? '-'} · ${outcome.latencyMs}ms`,
    );

    const result: AgentRunResult = {
      id: run.id,
      task,
      status,
      finalStatus: outcome.finalStatus,
      stopReason: outcome.stopReason,
      answer: outcome.answer,
      citations: outcome.citations,
      claims: outcome.claims,
      faithfulness: outcome.faithfulness,
      usage: outcome.usage,
      toolCallCount: outcome.toolCallCount,
      stepCount: outcome.steps.length,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
    };
    if (this.langfuse.enabled) void this.langfuse.record(result, outcome);
    return result;
  }

  async get(id: string): Promise<AgentRunResult> {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`AgentRun ${id} không tồn tại`);
    return {
      id: run.id,
      task: run.task,
      status: run.status,
      finalStatus: run.finalStatus,
      stopReason: run.stopReason ?? 'final',
      answer: run.answer,
      citations: (run.citations as unknown as AgentCitation[]) ?? [],
      claims: (run.claims as unknown as VerifiedClaim[]) ?? [],
      faithfulness:
        run.faithfulness === null
          ? null
          : {
              score: run.faithfulness,
              grounded: run.faithfulness >= 0.8,
              claims: [],
            },
      usage: (run.usage as unknown as AgentUsage) ?? {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
      },
      toolCallCount: 0,
      stepCount: run.stepCount,
      latencyMs: run.latencyMs ?? 0,
      error: run.error ?? undefined,
    };
  }

  /**
   * Huỷ một run đang RUNNING: abort nếu đang chạy trong process này + set
   * status CANCELLED. Idempotent; run đã kết thúc ⇒ 409.
   */
  async cancel(id: string): Promise<{ id: string; status: AgentRunStatus }> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!run) throw new NotFoundException(`AgentRun ${id} không tồn tại`);
    if (run.status !== AgentRunStatus.RUNNING) {
      throw new ConflictException(
        `AgentRun ${id} đã ở trạng thái ${run.status} — không huỷ được`,
      );
    }
    this.running.get(id)?.abort();
    await this.prisma.agentRun.update({
      where: { id },
      data: { status: AgentRunStatus.CANCELLED, stopReason: 'cancelled' },
    });
    this.logger.warn(`agent run ${id} bị huỷ`);
    return { id, status: AgentRunStatus.CANCELLED };
  }

  /** Các step có index > `afterIndex`, theo thứ tự — cho SSE stream. */
  async stepsSince(
    id: string,
    afterIndex: number,
  ): Promise<
    {
      index: number;
      type: string;
      toolName: string | null;
      note: string | null;
    }[]
  > {
    return this.prisma.agentStep.findMany({
      where: { agentRunId: id, index: { gt: afterIndex } },
      orderBy: { index: 'asc' },
      select: { index: true, type: true, toolName: true, note: true },
    });
  }

  async statusOf(id: string): Promise<AgentRunStatus | null> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      select: { status: true },
    });
    return run?.status ?? null;
  }

  async getTrace(id: string): Promise<{
    id: string;
    task: string;
    status: AgentRunStatus;
    trace: unknown;
    steps: unknown[];
  }> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      include: { steps: { orderBy: { index: 'asc' } } },
    });
    if (!run) throw new NotFoundException(`AgentRun ${id} không tồn tại`);
    return {
      id: run.id,
      task: run.task,
      status: run.status,
      trace: run.trace,
      steps: run.steps,
    };
  }
}

function mapStatus(outcome: AgentRunOutcome): AgentRunStatus {
  if (outcome.stopReason === 'cancelled') return AgentRunStatus.CANCELLED;
  if (outcome.stopReason === 'error') return AgentRunStatus.FAILED;
  if (outcome.finalStatus === 'INSUFFICIENT_EVIDENCE') {
    return AgentRunStatus.ABSTAINED;
  }
  return AgentRunStatus.COMPLETED;
}

function buildTrace(outcome: AgentRunOutcome): Record<string, unknown> {
  return {
    stopReason: outcome.stopReason,
    finalStatus: outcome.finalStatus,
    toolCallCount: outcome.toolCallCount,
    stepCount: outcome.steps.length,
    latencyMs: outcome.latencyMs,
    usage: outcome.usage,
    evidenceCount: outcome.evidence.length,
    steps: outcome.steps.map((s) => ({
      index: s.index,
      type: s.type,
      toolName: s.toolName,
      note: s.note,
      error: s.error,
      latencyMs: s.latencyMs,
    })),
  };
}
