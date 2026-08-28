import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ConfigError } from '../../common/errors';
import { EmbeddingProviderName } from '../llm/llm-provider.enum';
import type { EmbeddingProvider } from './embedding.interface';
import { CustomEmbeddingProvider } from './providers/custom-embedding.provider';
import { FakeEmbeddingProvider } from './providers/fake-embedding.provider';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';

/** Phân giải {@link EmbeddingProvider} theo tên; mặc định lấy từ `EMBEDDING_PROVIDER`. */
@Injectable()
export class EmbeddingFactoryService {
  private readonly registry: Record<EmbeddingProviderName, EmbeddingProvider>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    openai: OpenAiEmbeddingProvider,
    gemini: GeminiEmbeddingProvider,
    custom: CustomEmbeddingProvider,
    fake: FakeEmbeddingProvider,
  ) {
    this.registry = {
      [EmbeddingProviderName.OPENAI]: openai,
      [EmbeddingProviderName.GEMINI]: gemini,
      [EmbeddingProviderName.CUSTOM]: custom,
      [EmbeddingProviderName.FAKE]: fake,
    };
  }

  get defaultProviderName(): EmbeddingProviderName {
    return this.config.get('embedding', { infer: true })
      .provider as EmbeddingProviderName;
  }

  create(provider?: EmbeddingProviderName): EmbeddingProvider {
    const name = provider ?? this.defaultProviderName;
    const impl = this.registry[name];
    if (!impl) {
      throw new ConfigError(`Unknown embedding provider: ${String(name)}`);
    }
    return impl;
  }

  all(): EmbeddingProvider[] {
    return Object.values(this.registry);
  }
}
