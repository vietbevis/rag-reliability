import { Annotation } from '@langchain/langgraph';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import type {
  FaithfulnessResult,
  RagStatus,
  VerifiedClaim,
} from '../../common/types';
import type { ToolEvidence } from '../tools/tool.interface';

/**
 * Citation của agent — mở rộng {@link CitationKind} của RAG cho nguồn tính
 * toán. `chunk`/`graph` ⇒ trỏ tài liệu KB; `computation` ⇒ kết quả tool tính.
 */
export interface AgentCitation {
  claimId: string;
  claimText: string;
  kind: 'chunk' | 'graph' | 'computation';
  documentId?: string;
  chunkId?: string;
  section?: string;
  page?: number;
  valid: boolean;
}

/** Lý do vòng lặp agent dừng. `final` = model tự chốt câu trả lời. */
export type AgentStopReason =
  | 'final'
  | 'budget_steps'
  | 'budget_tool_calls'
  | 'budget_wall_clock'
  | 'budget_tokens'
  | 'budget_cost'
  | 'no_progress'
  | 'cancelled'
  | 'error';

export type AgentStepType =
  'THINK' | 'TOOL_CALL' | 'TOOL_RESULT' | 'FINAL' | 'GUARD_STOP';

/** Một mục trong trajectory — persist ở 17.6, hiện chỉ giữ trong RAM. */
export interface AgentStepRecord {
  index: number;
  type: AgentStepType;
  toolName?: string;
  toolInput?: unknown;
  /** Kết quả tool (toàn văn — chưa cắt). */
  toolOutput?: unknown;
  evidence?: ToolEvidence[];
  tokens?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  note?: string;
  error?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

const concat = <T>(a: T[], b: T[]): T[] => a.concat(b);
const lastWrite = <T>(_prev: T, next: T): T => next;

/**
 * State của graph agent (PHASE 17 §4). `messages` là lịch sử hội thoại nhiều
 * vòng (system → user → assistant[+toolCalls] → tool → …). `steps`/`evidence`
 * tích luỹ; các tally (usage/toolCallCount) cộng dồn qua reducer.
 */
export const AgentStateAnnotation = Annotation.Root({
  task: Annotation<string>,
  startedAt: Annotation<number>({
    reducer: lastWrite,
    default: () => Date.now(),
  }),

  messages: Annotation<ChatMessage[]>({ reducer: concat, default: () => [] }),
  steps: Annotation<AgentStepRecord[]>({ reducer: concat, default: () => [] }),
  evidence: Annotation<ToolEvidence[]>({ reducer: concat, default: () => [] }),

  /** Số lần một (toolName + args chuẩn hoá) đã được yêu cầu — cho loop-detector. */
  toolInvocations: Annotation<Record<string, number>>({
    reducer: (a, b) => {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
      return out;
    },
    default: () => ({}),
  }),
  toolCallCount: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  /** Số vòng `agent` không sinh evidence mới liên tiếp — cho no-progress. */
  noProgressStreak: Annotation<number>({
    reducer: lastWrite,
    default: () => 0,
  }),

  usage: Annotation<AgentUsage>({
    reducer: (a, b) => ({
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      estimatedCost: a.estimatedCost + b.estimatedCost,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0, estimatedCost: 0 }),
  }),

  answer: Annotation<string | null>({
    reducer: lastWrite,
    default: () => null,
  }),
  stopReason: Annotation<AgentStopReason | null>({
    reducer: lastWrite,
    default: () => null,
  }),

  // --- Kết quả sau `finalize` (17.5) ---
  finalStatus: Annotation<RagStatus | null>({
    reducer: lastWrite,
    default: () => null,
  }),
  citations: Annotation<AgentCitation[]>({
    reducer: lastWrite,
    default: () => [],
  }),
  verifiedClaims: Annotation<VerifiedClaim[]>({
    reducer: lastWrite,
    default: () => [],
  }),
  faithfulness: Annotation<FaithfulnessResult | null>({
    reducer: lastWrite,
    default: () => null,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
