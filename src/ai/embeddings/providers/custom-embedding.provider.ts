import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Embeddings } from '@langchain/core/embeddings';
import type { AppConfig } from '../../../config/configuration';
import { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import { BaseLangChainEmbeddingProvider } from './base-langchain-embedding.provider';

/** Endpoint embedding tương thích OpenAI (PROMPT §4.4). */
@Injectable()
export class CustomEmbeddingProvider extends BaseLangChainEmbeddingProvider {
  readonly provider = EmbeddingProviderName.CUSTOM;

  private readonly custom: AppConfig['embedding']['custom'];

  constructor(config: ConfigService<AppConfig, true>) {
    const embedding = config.get('embedding', { infer: true });
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
      batchSize: embedding.batchSize,
      dimensions: embedding.dimension,
    });
    this.custom = embedding.custom;
  }

  get defaultModel(): string {
    return this.custom.model ?? 'custom-embedding';
  }

  protected getClient(): Embeddings | null {
    if (!this.custom.baseUrl || !this.custom.model) return null;
    return new OpenAIEmbeddings({
      apiKey: this.custom.apiKey ?? 'not-required',
      model: this.custom.model,
      maxRetries: 0,
      configuration: { baseURL: this.custom.baseUrl },
    });
  }
}
