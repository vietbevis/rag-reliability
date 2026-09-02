import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { AppConfig } from '../../config/configuration';
import { LlmService } from '../../ai/llm/llm.service';
import type {
  FaithfulnessResult,
  RagStatus,
  VerifiedClaim,
} from '../../common/types';
import { AnswerVerificationService } from '../../rag/grounding/answer-verification.service';
import type { ToolEvidence } from '../tools/tool.interface';
import { ToolRegistryService } from '../tools/tool-registry.service';
import {
  AgentStateAnnotation,
  type AgentCitation,
  type AgentState,
  type AgentStopReason,
  type AgentStepRecord,
  type AgentUsage,
} from './agent-state';
import { checkBudget, type AgentLimits } from './guards/budget.guard';
import { createAgentNode } from './nodes/agent.node';
import { createFinalizeNode } from './nodes/finalize.node';
import { createToolNode } from './nodes/tool.node';

/** Sau ngần này vòng `agent` không sinh evidence mới ⇒ dừng (no-progress). */
const MAX_NO_PROGRESS_STREAK = 3;

export interface AgentRunOptions {
  toolAllowlist?: string[];
  agentRunId?: string;
  /** Ghi đè `AGENT_COST_BUDGET_USD` cho request này. */
  costBudgetUsd?: number;
  /** Huỷ run (cancel / shutdown) — abort xuyên xuống LLM + tool. */
  signal?: AbortSignal;
}

export interface AgentRunOutcome {
  task: string;
  answer: string | null;
  /** Lý do vòng lặp dừng (`final` = model tự chốt). */
  stopReason: AgentStopReason;
  /** Trạng thái độ tin cậy sau `finalize` (verify). `null` khi run lỗi. */
  finalStatus: RagStatus | null;
  citations: AgentCitation[];
  claims: VerifiedClaim[];
  faithfulness: FaithfulnessResult | null;
  steps: AgentStepRecord[];
  evidence: ToolEvidence[];
  usage: AgentUsage;
  toolCallCount: number;
  latencyMs: number;
  /** Chỉ có khi `stopReason === 'error'`. */
  error?: string;
}

/**
 * Dựng và chạy graph agent (PHASE 17 §4). Vòng lặp `agent ⇄ tool` có guard
 * (budget + loop + no-progress); mọi đường kết thúc đi qua `finalize` — verify
 * grounding/citation/faithfulness + map `RagStatus` (17.5). Chưa persist (17.6).
 */
@Injectable()
export class AgentGraphBuilder {
  private readonly logger = new Logger(AgentGraphBuilder.name);
  private readonly cfg: AppConfig['agent'];

  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
    private readonly verification: AnswerVerificationService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('agent', { infer: true });
  }

  async run(
    task: string,
    opts: AgentRunOptions = {},
  ): Promise<AgentRunOutcome> {
    const startedAt = Date.now();
    const limits: AgentLimits = {
      ...this.cfg.limits,
      costBudgetUsd: opts.costBudgetUsd ?? this.cfg.limits.costBudgetUsd,
    };
    const tools = this.registry.resolve(opts.toolAllowlist);
    this.logger.log(
      `agent run: "${task.slice(0, 80)}" · ${tools.length} tool · maxSteps=${limits.maxSteps}`,
    );

    const graph = this.compile(tools, limits, opts.agentRunId ?? 'adhoc');

    try {
      const final = await graph.invoke(
        { task, startedAt },
        { recursionLimit: limits.maxSteps * 2 + 6, signal: opts.signal },
      );
      return this.toOutcome(task, final, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'lỗi không xác định';
      const cancelled = opts.signal?.aborted === true;
      if (cancelled) this.logger.warn('agent run bị huỷ (cancel)');
      else this.logger.error(`agent run lỗi: ${message}`);
      return {
        task,
        answer: null,
        stopReason: cancelled ? 'cancelled' : 'error',
        finalStatus: null,
        citations: [],
        claims: [],
        faithfulness: null,
        steps: [],
        evidence: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
        toolCallCount: 0,
        latencyMs: Date.now() - startedAt,
        error: message,
      };
    }
  }

  private compile(
    tools: ReturnType<ToolRegistryService['resolve']>,
    limits: AgentLimits,
    agentRunId: string,
  ) {
    const agentNode = createAgentNode({
      llm: this.llm,
      toolSpecs: this.registry.toSpecs(tools),
      model: this.cfg.model,
      logger: this.logger,
    });
    const toolNode = createToolNode({
      registry: this.registry,
      agentRunId,
      toolResultMaxChars: limits.toolResultMaxTokens * 4,
      loopThreshold: limits.loopRepeatThreshold,
      logger: this.logger,
    });
    const finalizeNode = createFinalizeNode({
      verification: this.verification,
      logger: this.logger,
    });

    const stoppedNode = (state: AgentState) => {
      const reason = resolveStop(state, limits) ?? 'budget_steps';
      this.logger.warn(`agent run dừng sớm: ${reason}`);
      return {
        stopReason: reason,
        steps: [
          {
            index: state.steps.length,
            type: 'GUARD_STOP' as const,
            note: reason,
          },
        ],
      };
    };

    return new StateGraph(AgentStateAnnotation)
      .addNode('agent', agentNode)
      .addNode('tool', toolNode)
      .addNode('stopped', stoppedNode)
      .addNode('finalize', finalizeNode)
      .addEdge(START, 'agent')
      .addConditionalEdges(
        'agent',
        (state: AgentState) => route(state, limits),
        {
          tool: 'tool',
          stopped: 'stopped',
          finalize: 'finalize',
        },
      )
      .addEdge('tool', 'agent')
      .addEdge('stopped', 'finalize')
      .addEdge('finalize', END)
      .compile();
  }

  private toOutcome(
    task: string,
    state: AgentState,
    startedAt: number,
  ): AgentRunOutcome {
    return {
      task,
      answer: state.answer,
      stopReason: state.stopReason ?? 'final',
      finalStatus: state.finalStatus,
      citations: state.citations,
      claims: state.verifiedClaims,
      faithfulness: state.faithfulness,
      steps: state.steps,
      evidence: state.evidence,
      usage: state.usage,
      toolCallCount: state.toolCallCount,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** `null` = còn chạy tiếp được. */
function resolveStop(
  state: AgentState,
  limits: AgentLimits,
): AgentStopReason | null {
  const budget = checkBudget(state, limits);
  if (budget.tripped) return budget.reason ?? 'budget_steps';
  if (state.noProgressStreak >= MAX_NO_PROGRESS_STREAK) return 'no_progress';
  return null;
}

function route(
  state: AgentState,
  limits: AgentLimits,
): 'tool' | 'stopped' | 'finalize' {
  if (state.answer !== null) return 'finalize';
  return resolveStop(state, limits) ? 'stopped' : 'tool';
}
