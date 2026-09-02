import type { AppConfig } from '../../../config/configuration';
import type { AgentState, AgentStopReason } from '../agent-state';

export type AgentLimits = AppConfig['agent']['limits'];

export interface BudgetVerdict {
  tripped: boolean;
  reason?: Extract<
    AgentStopReason,
    | 'budget_steps'
    | 'budget_tool_calls'
    | 'budget_wall_clock'
    | 'budget_tokens'
    | 'budget_cost'
  >;
  detail?: string;
}

const OK: BudgetVerdict = { tripped: false };

/**
 * Trần cứng chống vòng lặp bỏ chạy (PROMPT §52 · agent-tools.md §8). Gọi TRƯỚC
 * mỗi vòng `agent → tool`. Vượt bất kỳ trần nào ⇒ agent nhảy thẳng tới kết thúc
 * (17.5 sẽ là `finalize`), KHÔNG để lỗi lộ ra như câu trả lời.
 */
export function checkBudget(
  state: AgentState,
  limits: AgentLimits,
  now: number = Date.now(),
): BudgetVerdict {
  const stepCount = state.steps.length;
  if (stepCount >= limits.maxSteps) {
    return {
      tripped: true,
      reason: 'budget_steps',
      detail: `${stepCount}/${limits.maxSteps} bước`,
    };
  }
  if (state.toolCallCount >= limits.maxToolCalls) {
    return {
      tripped: true,
      reason: 'budget_tool_calls',
      detail: `${state.toolCallCount}/${limits.maxToolCalls} tool call`,
    };
  }
  const elapsed = now - state.startedAt;
  if (elapsed >= limits.maxWallClockMs) {
    return {
      tripped: true,
      reason: 'budget_wall_clock',
      detail: `${elapsed}ms/${limits.maxWallClockMs}ms`,
    };
  }
  const totalTokens = state.usage.inputTokens + state.usage.outputTokens;
  if (totalTokens >= limits.maxTotalTokens) {
    return {
      tripped: true,
      reason: 'budget_tokens',
      detail: `${totalTokens}/${limits.maxTotalTokens} token`,
    };
  }
  if (state.usage.estimatedCost >= limits.costBudgetUsd) {
    return {
      tripped: true,
      reason: 'budget_cost',
      detail: `$${state.usage.estimatedCost.toFixed(4)}/$${limits.costBudgetUsd}`,
    };
  }
  return OK;
}
