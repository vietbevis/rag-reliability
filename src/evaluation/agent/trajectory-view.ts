import type { AgentRunOutcome } from '../../agent/graph/agent-graph.builder';
import type {
  AgentCitation,
  AgentStepRecord,
} from '../../agent/graph/agent-state';
import type { FaithfulnessResult, VerifiedClaim } from '../../common/types';
import type { FailureClass } from '../../tools/core/failure';
import { classifyRunFailure } from '../../tools/core/failure';
import type { ToolEvidence } from '../../tools/core/tool.types';
import { specNameToToolId } from '../../tools/registry/tool-name';

/**
 * Góc nhìn CHUẨN HOÁ, chỉ-đọc của một agent run — evaluator + benchmark làm
 * việc trên đây, KHÔNG đụng runtime nội bộ (PROMPT §24). Mọi tool id ở dạng
 * canonical (`rag.search`, không phải `rag__search`).
 */
export interface TrajectoryView {
  task: string;
  answer: string | null;
  finalStatus: string | null;
  stopReason: string;
  failureClass: FailureClass | null;

  /** Tool đã YÊU CẦU gọi, theo thứ tự (có thể trùng). */
  toolsRequested: string[];
  /** Tool đã CHẠY thành công (có TOOL_RESULT không lỗi). */
  toolsSucceeded: string[];
  toolCallCount: number;
  stepCount: number;
  latencyMs: number;

  formatValid: number;
  formatTotal: number;

  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };

  steps: AgentStepRecord[];
  evidence: ToolEvidence[];
  citations: AgentCitation[];
  claims: VerifiedClaim[];
  faithfulness: FaithfulnessResult | null;

  /** Mã lỗi tool xuất hiện trong run. */
  toolErrorCodes: string[];
  /** Có ít nhất một tool lỗi rồi sau đó run vẫn về đích grounded. */
  recoveredFromToolError: boolean;
}

export function toTrajectoryView(outcome: AgentRunOutcome): TrajectoryView {
  const toolsRequested = outcome.steps
    .filter((s) => s.type === 'TOOL_CALL' && s.toolName)
    .map((s) => specNameToToolId(s.toolName as string));

  const toolsSucceeded = outcome.steps
    .filter((s) => s.type === 'TOOL_RESULT' && s.toolName && !s.error)
    .map((s) => specNameToToolId(s.toolName as string));

  const toolErrorCodes = outcome.steps
    .filter((s) => s.type === 'TOOL_RESULT' && s.errorCode)
    .map((s) => s.errorCode as string);

  const failure = classifyRunFailure({
    stopReason: outcome.stopReason,
    finalStatus: outcome.finalStatus,
    toolErrorCodes: outcome.toolErrorCodes,
    loopBlocked: outcome.loopBlocked,
    errorMessage: outcome.error,
  });

  const hadToolError = toolErrorCodes.length > 0;
  const grounded =
    outcome.finalStatus === 'GROUNDED' ||
    outcome.finalStatus === 'PARTIALLY_GROUNDED';

  return {
    task: outcome.task,
    answer: outcome.answer,
    finalStatus: outcome.finalStatus,
    stopReason: outcome.stopReason,
    failureClass: failure?.failureClass ?? null,
    toolsRequested,
    toolsSucceeded,
    toolCallCount: outcome.toolCallCount,
    stepCount: outcome.steps.length,
    latencyMs: outcome.latencyMs,
    formatValid: outcome.toolFormatValid,
    formatTotal: outcome.toolFormatTotal,
    usage: {
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      estimatedCost: outcome.usage.estimatedCost,
    },
    steps: outcome.steps,
    evidence: outcome.evidence,
    citations: outcome.citations,
    claims: outcome.claims,
    faithfulness: outcome.faithfulness,
    toolErrorCodes,
    recoveredFromToolError: hadToolError && grounded,
  };
}
