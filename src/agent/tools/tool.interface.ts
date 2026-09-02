import type { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { TokenUsage } from '../../common/types';

/**
 * Hợp đồng của một tool mà agent có thể gọi (PHASE 17 — xem
 * docs/architecture/agent-tools.md §5). Business logic phụ thuộc vào interface
 * này, không phụ thuộc một tool cụ thể.
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** Định danh ổn định, snake_case — dùng làm tên hàm khi bind vào LLM. */
  readonly name: string;
  /** Mô tả hướng model: nói rõ KHI NÀO nên dùng tool này. */
  readonly description: string;
  /** Schema tham số — dùng để bind vào model và validate lại args model sinh. */
  readonly inputSchema: ZodType<TInput>;
  /** Schema kết quả — kết quả tool luôn được validate trước khi trả cho agent. */
  readonly outputSchema: ZodType<TOutput>;
  /** `read` = không đổi trạng thái. v1 chỉ chấp nhận `read` (§3.1). */
  readonly access: 'read' | 'write';
  /** Hạn thời gian cho một lần gọi tool (ms). */
  readonly timeoutMs: number;
  /** Số lần thử lại tối đa khi tool lỗi tạm thời (0 = không retry). */
  readonly maxRetries: number;

  execute(
    input: TInput,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult<TOutput>>;
}

/** Ngữ cảnh một lần gọi tool. */
export interface AgentToolContext {
  /** Id của `AgentRun` đang chạy — để tool ghi trace/log gắn đúng run. */
  agentRunId: string;
  /** Bị abort khi guard huỷ (timeout / cancel / vượt ngân sách). */
  signal: AbortSignal;
  logger: Logger;
}

/**
 * Mẩu bằng chứng một tool đóng góp cho câu trả lời cuối. `finalize.node` gom
 * mọi evidence của run để chạy grounding + citation (§9).
 */
export interface ToolEvidence {
  kind: 'chunk' | 'graph' | 'computation';
  /** Tham chiếu nguồn: chunkId / entityId / biểu thức đã tính… */
  ref: string;
  /** Văn bản hoá để verify + trích dẫn. */
  text: string;
}

export interface AgentToolResult<T = unknown> {
  /** `false` = tool lỗi có kiểm soát; agent nhận lỗi này và tự xoay hướng. */
  ok: boolean;
  /** Dữ liệu đã validate theo `outputSchema` (khi `ok`). */
  data: T;
  evidence: ToolEvidence[];
  /** Token/chi phí nếu tool có gọi LLM (vd rag_search + rerank). */
  usage?: TokenUsage;
  /** Kết quả đã bị cắt bớt trước khi đưa lại cho LLM. */
  truncated?: boolean;
  /** Thông điệp lỗi ngắn khi `ok = false` — feed lại cho model. */
  error?: string;
}

/** Token DI cho mảng mọi {@link AgentTool} đã đăng ký. */
export const AGENT_TOOLS = Symbol('AGENT_TOOLS');
