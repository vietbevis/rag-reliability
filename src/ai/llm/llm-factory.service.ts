import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ConfigError } from '../../common/errors';
import { LlmProvider } from './llm-provider.enum';
import type { LLMProvider } from './llm.interface';
import { AnthropicLlmProvider } from './providers/anthropic-llm.provider';
import { CustomLlmProvider } from './providers/custom-llm.provider';
import { GeminiLlmProvider } from './providers/gemini-llm.provider';
import { OpenAiLlmProvider } from './providers/openai-llm.provider';

/**
 * Phân giải một hiện thực {@link LLMProvider} theo tên. Provider mặc định lấy
 * từ `LLM_PROVIDER`; có thể yêu cầu một provider cụ thể để
 * benchmark/experiment (PROMPT §4.5, §36).
 */
@Injectable()
export class LlmFactoryService {
  private readonly registry: Record<LlmProvider, LLMProvider>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    openai: OpenAiLlmProvider,
    gemini: GeminiLlmProvider,
    anthropic: AnthropicLlmProvider,
    custom: CustomLlmProvider,
  ) {
    this.registry = {
      [LlmProvider.OPENAI]: openai,
      [LlmProvider.GEMINI]: gemini,
      [LlmProvider.ANTHROPIC]: anthropic,
      [LlmProvider.CUSTOM]: custom,
    };
  }

  get defaultProviderName(): LlmProvider {
    return this.config.get('llm', { infer: true }).provider as LlmProvider;
  }

  create(provider?: LlmProvider): LLMProvider {
    const name = provider ?? this.defaultProviderName;
    const impl = this.registry[name];
    if (!impl) {
      throw new ConfigError(`Unknown LLM provider: ${String(name)}`);
    }
    return impl;
  }

  /** Mọi provider đã đăng ký, phục vụ endpoint `/ai/providers`. */
  all(): LLMProvider[] {
    return Object.values(this.registry);
  }
}
