import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../../../config/configuration';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import { BaseLangChainLlmProvider } from './base-langchain-llm.provider';

@Injectable()
export class GeminiLlmProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.GEMINI;

  private readonly gemini: AppConfig['llm']['gemini'];

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
    });
    this.gemini = llm.gemini;
  }

  get defaultModel(): string {
    return this.gemini.chatModel;
  }

  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.gemini.chatModel;
  }

  protected getModel(options?: LLMOptions): BaseChatModel | null {
    if (!this.gemini.apiKey) return null;
    return new ChatGoogleGenerativeAI({
      apiKey: this.gemini.apiKey,
      model: this.resolveModelName(options),
      temperature: options?.temperature ?? 0,
      maxOutputTokens: options?.maxTokens,
      maxRetries: 0,
    });
  }
}
