import type { ZodType } from 'zod';
import type { TokenUsage } from '../../common/types';
import type { LlmProvider } from './llm-provider.enum';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Chỉ cho `role: 'assistant'` khi lượt đó model yêu cầu gọi tool — cần để
   * dựng lại lịch sử hội thoại nhiều vòng (PHASE 17).
   */
  toolCalls?: ToolCall[];
  /** Chỉ cho `role: 'tool'` — id của tool_call mà message này trả kết quả. */
  toolCallId?: string;
  /** Chỉ cho `role: 'tool'` — tên tool (một số provider yêu cầu). */
  name?: string;
}

/**
 * Khai báo một tool cho model (PHASE 17). Schema tham số bằng Zod — được bind
 * vào model và dùng để đối chiếu lại `ToolCall.args` mà model sinh ra.
 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: ZodType<unknown>;
}

export interface ToolCall {
  /** id do model cấp; rỗng ⇒ nơi gọi tự sinh để ghép với tool result. */
  id: string;
  name: string;
  /**
   * Tham số model sinh, ĐÃ đối chiếu (`safeParse`) với `ToolSpec.parameters`
   * khi khớp tên tool: hợp lệ ⇒ giá trị đã parse; không hợp lệ / tool lạ ⇒ giữ
   * nguyên giá trị thô và `argsValid = false` (PROMPT §50 — không tin output
   * thô của LLM).
   */
  args: unknown;
  argsValid: boolean;
}

export interface LLMToolResponse extends LLMResponse {
  /** Rỗng ⇒ model trả lời thẳng (dùng `content`). */
  toolCalls: ToolCall[];
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
  /**
   * Ép model gọi tool ở `chatWithTools` (PHASE 17.11). `'required'` = phải gọi
   * ít nhất một tool (không được trả lời thẳng) — dùng ở lượt agent đầu tiên để
   * chống model "lười" bỏ qua tool. `'auto'` (mặc định) = tự quyết. Provider
   * không hỗ trợ ⇒ tự bỏ qua (best-effort).
   */
  toolChoice?: 'auto' | 'required';
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
   * Provider hỗ trợ tool-calling native (`bindTools`) hay không (PHASE 17).
   * `false` ⇒ nơi gọi (agent loop) tự chuyển sang fallback constrained-JSON.
   */
  supportsNativeToolCalling(): boolean;

  /**
   * Một lượt chat có thể trả về yêu cầu gọi tool. `tools` được bind vào model;
   * `toolCalls` trả về đã được đối chiếu với schema tương ứng. Nơi gọi chịu
   * trách nhiệm thực thi tool rồi feed `ChatMessage` role `'tool'` ở lượt sau
   * (PHASE 17 — xem docs/architecture/agent-tools.md §6).
   */
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolSpec[],
    options?: LLMOptions,
  ): Promise<LLMToolResponse>;

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
