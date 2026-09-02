import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
 * `AgentController` (17.7); service này luôn chạy được (dùng bởi test/eval).
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly defaultBudget: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: AgentGraphBuilder,
    config: ConfigService<AppConfig, true>,
  ) {
    this.defaultBudget = config.get('agent', {
      infer: true,
    }).limits.costBudgetUsd;
  }

  async run(
    task: string,
    opts: AgentServiceRunOptions = {},
  ): Promise<AgentRunResult> {
    const run = await this.prisma.agentRun.create({
      data: {
        task,
        toolAllowlist: opts.toolAllowlist ?? [],
        costBudgetUsd: opts.costBudgetUsd ?? this.defaultBudget,
      },
      select: { id: true },
    });

    const outcome = await this.graph.run(task, {
      agentRunId: run.id,
      toolAllowlist: opts.toolAllowlist,
      costBudgetUsd: opts.costBudgetUsd,
    });

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

    return {
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
