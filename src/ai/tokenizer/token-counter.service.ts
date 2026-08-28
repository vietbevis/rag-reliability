import { Injectable, Logger } from '@nestjs/common';
import { getEncoding, encodingForModel, type Tiktoken } from 'js-tiktoken';
import type { ChatMessage } from '../llm/llm.interface';

/**
 * Đếm token để áp ngân sách context và ước tính chi phí (PROMPT §21, §55, §56).
 * Dùng `cl100k_base` làm chuẩn chung cho mọi provider; chính xác với OpenAI,
 * xấp xỉ khá sát với Gemini/Anthropic (xem docs/architecture/llm-providers.md).
 */
@Injectable()
export class TokenCounterService {
  private readonly logger = new Logger(TokenCounterService.name);
  private readonly base: Tiktoken = getEncoding('cl100k_base');
  private readonly cache = new Map<string, Tiktoken>();

  private encoder(model?: string): Tiktoken {
    if (!model) return this.base;
    const cached = this.cache.get(model);
    if (cached) return cached;
    try {
      const enc = encodingForModel(
        model as Parameters<typeof encodingForModel>[0],
      );
      this.cache.set(model, enc);
      return enc;
    } catch {
      this.cache.set(model, this.base);
      return this.base;
    }
  }

  count(text: string, model?: string): number {
    if (!text) return 0;
    return this.encoder(model).encode(text).length;
  }

  /** Ước tính token chat, gồm cả overhead role mỗi message (~4/msg). */
  countMessages(messages: ChatMessage[], model?: string): number {
    const enc = this.encoder(model);
    return messages.reduce(
      (sum, m) => sum + enc.encode(m.content).length + 4,
      2,
    );
  }
}
