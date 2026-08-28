import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../../../config/configuration';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import { BaseLangChainLlmProvider } from './base-langchain-llm.provider';

@Injectable()
export class OpenAiLlmProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.OPENAI;

  private readonly openai: AppConfig['llm']['openai'];

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
    });
    this.openai = llm.openai;
  }

  get defaultModel(): string {
    return this.openai.chatModel;
  }

  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.openai.chatModel;
  }

  protected getModel(options?: LLMOptions): BaseChatModel | null {
    if (!this.openai.apiKey) return null;
    return new ChatOpenAI({
      apiKey: this.openai.apiKey,
      model: this.resolveModelName(options),
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens,
      timeout: options?.timeoutMs ?? this.cfg.timeoutMs,
      maxRetries: 0, // retry do withRetry() đảm nhiệm
      configuration: this.openai.baseUrl
        ? { baseURL: this.openai.baseUrl }
        : undefined,
    });
  }
}
