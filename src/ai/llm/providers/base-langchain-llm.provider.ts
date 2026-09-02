import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { tool as lcTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { LlmError } from '../../../common/errors';
import type { TokenUsage } from '../../../common/types';
import { LlmProvider } from '../llm-provider.enum';
import type {
  ChatMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  LLMToolResponse,
  StructuredResult,
  ToolCall,
  ToolSpec,
} from '../llm.interface';
import { estimateCost } from '../pricing';
import { classifyProviderError, withRetry } from '../retry.util';

export interface BaseLangChainLlmConfig {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

interface UsageMetadataShape {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

/**
 * Hiện thực dùng chung của {@link LLMProvider} dựa trên bất kỳ `BaseChatModel`
 * nào của LangChain. Các provider cụ thể chỉ cần cung cấp một instance model đã
 * cấu hình và metadata; retry, timeout, phân loại lỗi, kế toán token và ước
 * tính chi phí đều được xử lý thống nhất ở đây (PROMPT §4.6, §52, §56).
 */
export abstract class BaseLangChainLlmProvider implements LLMProvider {
  protected readonly logger: Logger;

  abstract readonly provider: LlmProvider;
  abstract readonly defaultModel: string;

  protected constructor(protected readonly cfg: BaseLangChainLlmConfig) {
    this.logger = new Logger(this.constructor.name);
  }

  /** Model LangChain đã cấu hình, hoặc `null` khi thiếu credentials. */
  protected abstract getModel(options?: LLMOptions): BaseChatModel | null;

  isConfigured(): boolean {
    return this.getModel() !== null;
  }

  async chat(
    messages: ChatMessage[],
    options: LLMOptions = {},
  ): Promise<LLMResponse> {
    const model = this.requireModel(options);
    const lcMessages = toLangChainMessages(messages);
    const started = Date.now();

    const { value: response } = await withRetry(
      (signal) => model.invoke(lcMessages, { signal }),
      this.retryOpts(options.traceLabel ?? 'llm.chat', options),
    ).catch((err) => {
      throw this.wrap(err, 'chat');
    });

    const latencyMs = Date.now() - started;
    const modelName = this.resolveModelName(options);
    const usage = this.toTokenUsage(
      (response as AIMessage).usage_metadata,
      response.response_metadata,
      modelName,
    );

    return {
      content: messageContentToString(response.content),
      usage,
      model: modelName,
      provider: this.provider,
      latencyMs,
      finishReason: extractFinishReason(response.response_metadata),
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    options: LLMOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const model = this.requireModel(options);
    const lcMessages = toLangChainMessages(messages);

    let stream: AsyncIterable<{ content: unknown }>;
    try {
      stream = await model.stream(lcMessages);
    } catch (err) {
      throw this.wrap(err, 'chatStream');
    }

    try {
      for await (const chunk of stream) {
        const delta = messageContentToString(chunk.content);
        if (delta) yield { delta, done: false };
      }
      yield { delta: '', done: true };
    } catch (err) {
      throw this.wrap(err, 'chatStream');
    }
  }

  supportsNativeToolCalling(): boolean {
    const model = this.getModel();
    return model !== null && typeof model.bindTools === 'function';
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolSpec[],
    options: LLMOptions = {},
  ): Promise<LLMToolResponse> {
    const model = this.requireModel(options);
    const bindTools = model.bindTools?.bind(model);
    if (typeof bindTools !== 'function') {
      throw new LlmError(
        'BAD_REQUEST',
        `${this.provider} model không hỗ trợ tool-calling native`,
        { provider: this.provider },
      );
    }

    const lcMessages = toLangChainMessages(messages);
    // `tool()` chỉ dùng để bind schema — hàm thực thi không bao giờ được gọi ở
    // đây (agent loop tự thực thi tool rồi feed ToolMessage ở lượt sau).
    const lcTools = tools.map((spec) =>
      lcTool(() => '', {
        name: spec.name,
        description: spec.description,
        schema: spec.parameters,
      }),
    );
    const bind = (choice?: 'auto' | 'required') =>
      bindTools(
        lcTools,
        choice ? { tool_choice: choice } : undefined,
      ) as unknown as {
        invoke(
          messages: BaseMessage[],
          options?: { signal?: AbortSignal },
        ): Promise<AIMessage>;
      };
    const started = Date.now();

    const { value: response } = await withRetry(
      (signal) => bind(options.toolChoice).invoke(lcMessages, { signal }),
      this.retryOpts(options.traceLabel ?? 'llm.tools', options),
    ).catch(async (err) => {
      // Model/endpoint không nuốt `tool_choice` (400) ⇒ thử lại KHÔNG ép (§17.11).
      if (options.toolChoice) {
        this.logger.warn(
          `${this.provider} không hỗ trợ tool_choice — thử lại không ép`,
        );
        return withRetry(
          (signal) => bind(undefined).invoke(lcMessages, { signal }),
          this.retryOpts(options.traceLabel ?? 'llm.tools', options),
        ).catch((e) => {
          throw this.wrap(e, 'chatWithTools');
        });
      }
      throw this.wrap(err, 'chatWithTools');
    });

    const latencyMs = Date.now() - started;
    const modelName = this.resolveModelName(options);
    const toolCalls = validateToolCalls(
      response.tool_calls ?? [],
      tools,
      this.logger,
    );

    return {
      content: messageContentToString(response.content),
      usage: this.toTokenUsage(
        response.usage_metadata,
        response.response_metadata,
        modelName,
      ),
      model: modelName,
      provider: this.provider,
      latencyMs,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : extractFinishReason(response.response_metadata),
      toolCalls,
    };
  }

  async chatStructured<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    options: LLMOptions = {},
  ): Promise<StructuredResult<T>> {
    const model = this.requireModel(options);
    const lcMessages = toLangChainMessages(messages);
    const started = Date.now();

    const structured = model.withStructuredOutput(
      schema as Parameters<typeof model.withStructuredOutput>[0],
      { includeRaw: true },
    );

    const { value } = await withRetry(
      (signal) => structured.invoke(lcMessages, { signal }),
      this.retryOpts(options.traceLabel ?? 'llm.structured', options),
    ).catch((err) => {
      throw this.wrap(err, 'chatStructured');
    });

    const { raw, parsed } = value as {
      raw: AIMessage;
      parsed: T;
    };

    // Không bao giờ tin tưởng mù quáng việc provider ép schema (PROMPT §50).
    const validated = schema.parse(parsed);
    const latencyMs = Date.now() - started;
    const modelName = this.resolveModelName(options);

    return {
      data: validated,
      usage: this.toTokenUsage(
        raw.usage_metadata,
        raw.response_metadata,
        modelName,
      ),
      model: modelName,
      provider: this.provider,
      latencyMs,
    };
  }

  // --- nội bộ ----------------------------------------------------------

  protected abstract resolveModelName(options?: LLMOptions): string;

  private requireModel(options?: LLMOptions): BaseChatModel {
    const model = this.getModel(options);
    if (!model) {
      throw new LlmError(
        'AUTH',
        `${this.provider} provider is not configured (missing API key or base URL)`,
        { provider: this.provider },
      );
    }
    return model;
  }

  private retryOpts(label: string, options: LLMOptions) {
    return {
      label,
      maxRetries: options.retryConfig?.maxRetries ?? this.cfg.maxRetries,
      baseDelayMs:
        options.retryConfig?.baseDelayMs ?? this.cfg.retryBaseDelayMs,
      timeoutMs: options.timeoutMs ?? this.cfg.timeoutMs,
      logger: this.logger,
    };
  }

  private wrap(err: unknown, op: string): LlmError {
    if (err instanceof LlmError) return err;
    const { kind, retryable } = classifyProviderError(err);
    return new LlmError(
      kind,
      `${this.provider} ${op} failed: ${(err as Error)?.message ?? 'unknown error'}`,
      { provider: this.provider, op },
      { cause: err, retryable },
    );
  }

  private toTokenUsage(
    usageMetadata: UsageMetadataShape | undefined,
    responseMetadata: Record<string, unknown> | undefined,
    model: string,
  ): TokenUsage {
    const fallback = extractLegacyUsage(responseMetadata);
    const inputTokens = usageMetadata?.input_tokens ?? fallback.input ?? 0;
    const outputTokens = usageMetadata?.output_tokens ?? fallback.output ?? 0;
    const totalTokens =
      usageMetadata?.total_tokens ?? inputTokens + outputTokens;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost: estimateCost(
        this.provider,
        model,
        inputTokens,
        outputTokens,
      ),
    };
  }
}

// --- helper cấp module -------------------------------------------------

export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return new SystemMessage(m.content);
      case 'assistant':
        return m.toolCalls && m.toolCalls.length > 0
          ? new AIMessage({
              content: m.content,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id || undefined,
                name: tc.name,
                args: (tc.args ?? {}) as Record<string, unknown>,
                type: 'tool_call' as const,
              })),
            })
          : new AIMessage(m.content);
      case 'tool':
        return new ToolMessage({
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
          name: m.name,
        });
      case 'user':
      default:
        return new HumanMessage(m.content);
    }
  });
}

interface RawToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Đối chiếu tool call thô của model với `ToolSpec` tương ứng (PROMPT §50). Args
 * hợp lệ ⇒ thay bằng giá trị đã parse; tool lạ hoặc args sai schema ⇒ giữ thô,
 * `argsValid = false` để agent loop feed lỗi lại cho model ở lượt sau.
 */
export function validateToolCalls(
  raw: RawToolCall[],
  tools: ToolSpec[],
  logger?: Logger,
): ToolCall[] {
  const specByName = new Map(tools.map((t) => [t.name, t]));
  return raw.map((rc) => {
    const spec = specByName.get(rc.name);
    if (!spec) {
      logger?.warn(`chatWithTools: model gọi tool không khai báo "${rc.name}"`);
      return {
        id: rc.id ?? '',
        name: rc.name,
        args: rc.args,
        argsValid: false,
      };
    }
    const parsed = spec.parameters.safeParse(rc.args);
    if (!parsed.success) {
      logger?.warn(
        `chatWithTools: args cho tool "${rc.name}" không hợp lệ theo schema`,
      );
      return {
        id: rc.id ?? '',
        name: rc.name,
        args: rc.args,
        argsValid: false,
      };
    }
    return {
      id: rc.id ?? '',
      name: rc.name,
      args: parsed.data,
      argsValid: true,
    };
  });
}

export function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

function extractFinishReason(
  metadata: Record<string, unknown> | undefined,
): string {
  if (!metadata) return 'unknown';
  return (
    (metadata.finish_reason as string | undefined) ??
    (metadata.finishReason as string | undefined) ??
    (metadata.stop_reason as string | undefined) ??
    'stop'
  );
}

function extractLegacyUsage(metadata: Record<string, unknown> | undefined): {
  input?: number;
  output?: number;
} {
  if (!metadata) return {};
  const usage = (metadata.tokenUsage ?? metadata.usage ?? {}) as Record<
    string,
    number
  >;
  return {
    input: usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens,
    output:
      usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens,
  };
}
