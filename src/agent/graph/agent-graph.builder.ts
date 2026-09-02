import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { AppConfig } from '../../config/configuration';
import { LlmService } from '../../ai/llm/llm.service';
import type { ToolEvidence } from '../tools/tool.interface';
import { ToolRegistryService } from '../tools/tool-registry.service';
import {
  AgentStateAnnotation,
  type AgentState,
  type AgentStopReason,
  type AgentStepRecord,
  type AgentUsage,
} from './agent-state';
import { checkBudget, type AgentLimits } from './guards/budget.guard';
import { createAgentNode } from './nodes/agent.node';
import { createToolNode } from './nodes/tool.node';

/** Sau ngần này vòng `agent` không sinh evidence mới ⇒ dừng (no-progress). */
const MAX_NO_PROGRESS_STREAK = 3;

export interface AgentRunOptions {
  toolAllowlist?: string[];
  agentRunId?: string;
  /** Ghi đè `AGENT_COST_BUDGET_USD` cho request này. */
  costBudgetUsd?: number;
}

export interface AgentRunOutcome {
  task: string;
  answer: string | null;
  stopReason: AgentStopReason;
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
 * (budget + loop + no-progress) chặn trước mỗi lần vào `tool`. 17.3: câu trả
 * lời cuối trả THÔ — chưa qua `finalize` (grounding/citation/faithfulness ở
 * 17.5), chưa persist (17.6).
 */
@Injectable()
export class AgentGraphBuilder {
  private readonly logger = new Logger(AgentGraphBuilder.name);
  private readonly cfg: AppConfig['agent'];

  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
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
        { recursionLimit: limits.maxSteps * 2 + 6 },
      );
      return this.toOutcome(task, final, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'lỗi không xác định';
      this.logger.error(`agent run lỗi: ${message}`);
      return {
        task,
        answer: null,
        stopReason: 'error',
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
      .addEdge(START, 'agent')
      .addConditionalEdges(
        'agent',
        (state: AgentState) => route(state, limits),
        {
          tool: 'tool',
          stopped: 'stopped',
          end: END,
        },
      )
      .addEdge('tool', 'agent')
      .addEdge('stopped', END)
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
      stopReason: state.stopReason ?? 'error',
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
): 'tool' | 'stopped' | 'end' {
  if (state.stopReason === 'final' || state.answer !== null) return 'end';
  return resolveStop(state, limits) ? 'stopped' : 'tool';
}
