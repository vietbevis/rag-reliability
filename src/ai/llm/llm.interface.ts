import type { ZodType } from 'zod';
import type { TokenUsage } from '../../common/types';
import type { LlmProvider } from './llm-provider.enum';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retryConfig?: Partial<RetryConfig>;
  /** Gợi ý cho provider hỗ trợ chế độ JSON native. */
  responseFormat?: 'text' | 'json';
  /**
   * `false` → YÊU CẦU provider TẮT chế độ suy luận ("thinking"/reasoning) của
   * model. Dùng cho các tác vụ structured-output ngắn (vd graph extraction) —
   * khối reasoning làm mỗi lời gọi chậm gấp nhiều lần mà không lợi gì.
   * Bỏ trống = theo mặc định của model.
   */
  reasoning?: boolean;
  /** Nhãn mờ được truyền vào trace observability. */
  traceLabel?: string;
}

export interface LLMResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: LlmProvider;
  latencyMs: number;
  finishReason: string;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  provider: LlmProvider;
  latencyMs: number;
}

/**
 * Hợp đồng duy nhất mà mọi back-end LLM phải hiện thực (PROMPT §4.2). Business
 * logic chỉ phụ thuộc vào interface này — không bao giờ phụ thuộc vào một
 * provider cụ thể hay một class của LangChain.
 */
export interface LLMProvider {
  readonly provider: LlmProvider;
  /** Model mặc định khi `LLMOptions.model` không được truyền. */
  readonly defaultModel: string;
  /** Provider này đã có API key / base URL hay chưa. */
  isConfigured(): boolean;

  chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;

  chatStream(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): AsyncIterable<LLMStreamChunk>;

  /**
   * Decode có ràng buộc về một shape được Zod validate. Provider chịu trách
   * nhiệm ép schema; nơi gọi vẫn nhận dữ liệu đã có kiểu và đã validate
   * (PROMPT §23, §50 — không bao giờ tin output thô của LLM).
   */
  chatStructured<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    options?: LLMOptions,
  ): Promise<StructuredResult<T>>;
}
