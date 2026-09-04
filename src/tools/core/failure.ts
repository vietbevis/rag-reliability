import type { HallucinationRootCause } from '../../common/types';
import type { ToolErrorCode } from './tool.types';

/**
 * Phân loại lý do agent fail (PROMPT §32). Mục tiêu report: "agent fail vì đâu",
 * KHÔNG chỉ `score = 0`. Hàm thuần — dùng bởi runtime (persist `AgentRun`),
 * evaluator và benchmark.
 */
export type FailureClass =
  | 'AGENT_DECISION_ERROR'
  | 'TOOL_SELECTION_ERROR'
  | 'TOOL_ARGUMENT_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'MCP_PROVIDER_ERROR'
  | 'MCP_CONNECTION_ERROR'
  | 'MCP_TIMEOUT'
  | 'RAG_RETRIEVAL_ERROR'
  | 'RAG_GROUNDEDNESS_ERROR'
  | 'LLM_ERROR'
  | 'CONTEXT_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'SAFETY_POLICY_ERROR'
  | 'LOOP_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR';

/** Map `ToolErrorCode` → `FailureClass`. */
export function toolErrorToFailureClass(code: ToolErrorCode): FailureClass {
  switch (code) {
    case 'TOOL_ARGUMENT_ERROR':
      return 'TOOL_ARGUMENT_ERROR';
    case 'TOOL_TIMEOUT':
      return 'TIMEOUT_ERROR';
    case 'TOOL_NOT_FOUND':
    case 'TOOL_DISABLED':
      return 'TOOL_SELECTION_ERROR';
    case 'PERMISSION_DENIED':
      return 'AUTHORIZATION_ERROR';
    case 'LOOP_BLOCKED':
      return 'LOOP_ERROR';
    case 'PROVIDER_UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE';
    case 'MCP_CONNECTION_ERROR':
      return 'MCP_CONNECTION_ERROR';
    case 'MCP_TIMEOUT':
      return 'MCP_TIMEOUT';
    case 'MCP_PROTOCOL_ERROR':
    case 'MCP_REMOTE_ERROR':
      return 'MCP_PROVIDER_ERROR';
    case 'RAG_RETRIEVAL_ERROR':
      return 'RAG_RETRIEVAL_ERROR';
    case 'TOOL_EXECUTION_ERROR':
      return 'TOOL_EXECUTION_ERROR';
    default:
      return 'UNKNOWN_ERROR';
  }
}

export interface RunFailureView {
  /** `final` = model tự chốt; các giá trị khác = dừng sớm. */
  stopReason: string;
  /** `RagStatus` sau finalize, hoặc null khi run lỗi. */
  finalStatus: string | null;
  /** Mã lỗi tool xuất hiện trong trajectory (theo thứ tự). */
  toolErrorCodes: ToolErrorCode[];
  /** Có bị guard chặn vì lặp không. */
  loopBlocked: boolean;
  /** Message lỗi hạ tầng (khi stopReason === 'error'). */
  errorMessage?: string;
}

/**
 * Suy ra `FailureClass` cho một run KHÔNG đạt. Trả `undefined` khi run thành
 * công (GROUNDED/PARTIALLY_GROUNDED, hoặc INSUFFICIENT_EVIDENCE khi đó là kỳ
 * vọng — evaluator quyết định "đạt/không", hàm này chỉ phân loại lý do lỗi).
 */
export function classifyRunFailure(
  v: RunFailureView,
): { failureClass: FailureClass; detail: string } | undefined {
  if (v.stopReason === 'error') {
    // Lỗi hạ tầng — thử map từ message.
    const msg = v.errorMessage ?? '';
    if (/tool_choice|bindTools|tool-calling/i.test(msg)) {
      return { failureClass: 'AGENT_DECISION_ERROR', detail: msg };
    }
    return { failureClass: 'LLM_ERROR', detail: msg || 'run lỗi hạ tầng' };
  }

  if (v.stopReason === 'cancelled') return undefined;

  const lastToolError = v.toolErrorCodes[v.toolErrorCodes.length - 1];
  const nonLoopErrors = v.toolErrorCodes.filter((c) => c !== 'LOOP_BLOCKED');

  if (v.stopReason.startsWith('budget_') || v.stopReason === 'no_progress') {
    // Dừng sớm vì guard — quy về nguyên nhân sâu nếu có lỗi tool lặp lại.
    if (nonLoopErrors.length > 0) {
      const code = nonLoopErrors[nonLoopErrors.length - 1]!;
      return {
        failureClass: toolErrorToFailureClass(code),
        detail: `guard ${v.stopReason} sau lỗi tool ${code}`,
      };
    }
    if (v.loopBlocked || v.stopReason === 'no_progress') {
      return { failureClass: 'LOOP_ERROR', detail: v.stopReason };
    }
    return { failureClass: 'TIMEOUT_ERROR', detail: v.stopReason };
  }

  if (v.stopReason === 'tool_failure_threshold' && lastToolError) {
    return {
      failureClass: toolErrorToFailureClass(lastToolError),
      detail: 'vượt ngưỡng lỗi tool liên tiếp',
    };
  }

  // stopReason === 'final' nhưng finalize không grounded.
  if (v.finalStatus === 'INSUFFICIENT_EVIDENCE' && nonLoopErrors.length > 0) {
    const code = nonLoopErrors[nonLoopErrors.length - 1]!;
    return {
      failureClass: toolErrorToFailureClass(code),
      detail: `abstain sau lỗi tool ${code}`,
    };
  }
  if (v.finalStatus === 'CONFLICTING_EVIDENCE') {
    return {
      failureClass: 'RAG_GROUNDEDNESS_ERROR',
      detail: 'evidence mâu thuẫn',
    };
  }

  return undefined;
}

/** Ánh xạ nguyên nhân RAG (từ evaluator) → sub-class. */
export function ragRootCauseToFailureClass(
  rc: HallucinationRootCause,
): FailureClass {
  switch (rc) {
    case 'RETRIEVAL_FAILURE':
      return 'RAG_RETRIEVAL_ERROR';
    case 'GENERATION_HALLUCINATION':
    case 'CITATION_HALLUCINATION':
      return 'RAG_GROUNDEDNESS_ERROR';
    case 'MISSING_CONTEXT':
      return 'CONTEXT_ERROR';
    default:
      return 'UNKNOWN_ERROR';
  }
}
