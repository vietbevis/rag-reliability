import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../../../config/configuration';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import { BaseLangChainLlmProvider } from './base-langchain-llm.provider';

/**
 * Bất kỳ endpoint nào tương thích OpenAI (vLLM, Ollama, LiteLLM, tự host, …).
 * Dùng client OpenAI trỏ tới `CUSTOM_LLM_BASE_URL` (PROMPT §4.4).
 */
@Injectable()
export class CustomLlmProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.CUSTOM;

  private readonly custom: AppConfig['llm']['custom'];

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
    });
    this.custom = llm.custom;
  }

  get defaultModel(): string {
    return this.custom.model ?? 'custom-model';
  }

  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.custom.model ?? 'custom-model';
  }

  protected getModel(options?: LLMOptions): BaseChatModel | null {
    if (!this.custom.baseUrl || !this.custom.model) return null;
    return new ChatOpenAI({
      apiKey: this.custom.apiKey ?? 'not-required',
      model: this.resolveModelName(options),
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens,
      timeout: options?.timeoutMs ?? this.cfg.timeoutMs,
      maxRetries: 0,
      configuration: { baseURL: this.custom.baseUrl },
    });
  }
}
