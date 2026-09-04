import type { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { TokenUsage } from '../../common/types';

/**
 * Lớp tool thống nhất (target-state.md §3). Agent Core CHỈ phụ thuộc các kiểu ở
 * file này — không bao giờ biết một tool đến từ Local, MCP, HTTP hay provider
 * tương lai nào (PROMPT §1, §6).
 */

/** Định danh canonical, ổn định, có namespace theo provider. */
export type ToolId = string;
export type ProviderId = string;

export type ToolSource = 'local' | 'mcp' | 'http' | 'grpc' | 'plugin';

/**
 * Mẩu bằng chứng một tool đóng góp cho câu trả lời cuối. `finalize` gom mọi
 * evidence của run để chạy grounding + citation (target-state.md §3.3). Giữ
 * nguyên shape lịch sử để không phá đường verify của RAG.
 */
export interface ToolEvidence {
  kind: 'chunk' | 'graph' | 'computation';
  /** Tham chiếu nguồn: chunkId / entityId / biểu thức đã tính… */
  ref: string;
  /** Văn bản hoá để verify + trích dẫn. */
  text: string;
  documentId?: string;
  chunkId?: string;
  score?: number;
  section?: string;
  heading?: string;
  page?: number;
}

export interface ToolMetadata {
  providerId: ProviderId;
  source: ToolSource;
  version?: string;
  /** read-only → low; mutation/send/delete → high. */
  riskLevel: 'low' | 'medium' | 'high';
  /** Cho Replay (PROMPT §36) — side-effecting KHÔNG bao giờ blind replay. */
  sideEffect: 'read-only' | 'side-effecting';
  /** high-risk ⇒ true — v1 read-only nên luôn false (PROMPT §14). */
  requiresConfirmation: boolean;
  enabled: boolean;
  tags?: string[];
  /** Hạn thời gian một lần gọi (ms). */
  timeoutMs: number;
  /** Số lần thử lại tối đa khi lỗi RETRYABLE (0 = không retry). */
  maxRetries: number;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: ToolId;
  displayName: string;
  /** Prompt-facing — nói rõ KHI NÀO nên dùng tool này. */
  description: string;
  /** GIỮ Zod: validate một lần, dùng cả khi bind vào LLM và khi đối chiếu args. */
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  metadata: ToolMetadata;
}

/** Mã lỗi tool đã chuẩn hoá (PROMPT §13). */
export type ToolErrorCode =
  | 'TOOL_ARGUMENT_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'TOOL_TIMEOUT'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'PERMISSION_DENIED'
  | 'LOOP_BLOCKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MCP_CONNECTION_ERROR'
  | 'MCP_TIMEOUT'
  | 'MCP_PROTOCOL_ERROR'
  | 'MCP_REMOTE_ERROR'
  | 'RAG_RETRIEVAL_ERROR'
  | 'UNKNOWN_ERROR';

/** Lỗi tool có kiểm soát — agent nhận và tự xoay hướng. */
export interface ToolError {
  code: ToolErrorCode;
  /** Feed lại model — ngắn, không lộ secret. */
  message: string;
  retryable: boolean;
  providerId?: ProviderId;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  /** Có khi `success` — đã validate theo `outputSchema`. */
  data?: T;
  /** Có khi `!success`. */
  error?: ToolError;
  /** Cột sống của reliability lab — gom cho `finalize` verify. */
  evidence: ToolEvidence[];
  /** Token/chi phí nếu tool có gọi LLM (vd rag.search + rerank). */
  usage?: TokenUsage;
  metadata?: {
    latencyMs?: number;
    source?: string;
    truncated?: boolean;
    citations?: unknown[];
  };
}

/** Ngữ cảnh một lần gọi tool (PROMPT §18). */
export interface ToolExecutionContext {
  runId: string;
  stepId: string;
  providerId: ProviderId;
  userId?: string;
  tenantId?: string;
  /** Bị abort khi guard huỷ (timeout / cancel / vượt ngân sách). */
  signal: AbortSignal;
  logger: Logger;
  metadata?: Record<string, unknown>;
}

/** Handle runtime của một tool — provider trả về từ `getTool`. */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly definition: ToolDefinition<TInput, TOutput>;
  execute(
    input: TInput,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>>;
}

/** Token DI cho mảng {@link AgentTool} local (bọc từ class hiện có). */
export const LOCAL_AGENT_TOOLS = Symbol('LOCAL_AGENT_TOOLS');

/** Helper tạo `ToolResult` lỗi. */
export function toolFailure(
  code: ToolErrorCode,
  message: string,
  opts: { retryable?: boolean; providerId?: ProviderId } = {},
): ToolResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: opts.retryable ?? RETRYABLE_CODES.has(code),
      providerId: opts.providerId,
    },
    evidence: [],
  };
}

const RETRYABLE_CODES = new Set<ToolErrorCode>([
  'TOOL_TIMEOUT',
  'TOOL_EXECUTION_ERROR',
  'PROVIDER_UNAVAILABLE',
  'MCP_CONNECTION_ERROR',
  'MCP_TIMEOUT',
  'RAG_RETRIEVAL_ERROR',
]);
