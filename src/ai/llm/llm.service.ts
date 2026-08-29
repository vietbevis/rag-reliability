import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { LlmProvider } from './llm-provider.enum';
import { LlmFactoryService } from './llm-factory.service';
import type {
  ChatMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamChunk,
  StructuredResult,
} from './llm.interface';

/**
 * Điểm vào thống nhất cho mọi lời gọi LLM. Uỷ thác cho provider mặc định đã
 * cấu hình (hoặc một provider chỉ định). Đây là chỗ để cắm cơ chế fallback
 * giữa các provider (PROMPT §54) — hoãn lại tới khi có cấu hình fallback.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly factory: LlmFactoryService) {}

  get activeProvider(): LlmProvider {
    return this.factory.defaultProviderName;
  }

  /** Model chat mặc định của provider đang active — dùng làm khoá cache. */
  get activeModel(): string {
    return this.factory.create().defaultModel;
  }

  chat(
    messages: ChatMessage[],
    options?: LLMOptions & { provider?: LlmProvider },
  ): Promise<LLMResponse> {
    return this.factory.create(options?.provider).chat(messages, options);
  }

  chatStream(
    messages: ChatMessage[],
    options?: LLMOptions & { provider?: LlmProvider },
  ): AsyncIterable<LLMStreamChunk> {
    return this.factory.create(options?.provider).chatStream(messages, options);
  }

  chatStructured<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    options?: LLMOptions & { provider?: LlmProvider },
  ): Promise<StructuredResult<T>> {
    return this.factory
      .create(options?.provider)
      .chatStructured(messages, schema, options);
  }
}
