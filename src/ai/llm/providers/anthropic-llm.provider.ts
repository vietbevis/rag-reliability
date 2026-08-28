import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../../../config/configuration';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import { BaseLangChainLlmProvider } from './base-langchain-llm.provider';

@Injectable()
export class AnthropicLlmProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.ANTHROPIC;

  private readonly anthropic: AppConfig['llm']['anthropic'];

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
    });
    this.anthropic = llm.anthropic;
  }

  get defaultModel(): string {
    return this.anthropic.chatModel;
  }

  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.anthropic.chatModel;
  }

  protected getModel(options?: LLMOptions): BaseChatModel | null {
    if (!this.anthropic.apiKey) return null;
    return new ChatAnthropic({
      apiKey: this.anthropic.apiKey,
      model: this.resolveModelName(options),
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens ?? 4096,
      maxRetries: 0,
      clientOptions: { timeout: options?.timeoutMs ?? this.cfg.timeoutMs },
    });
  }
}
