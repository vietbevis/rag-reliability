import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Embeddings } from '@langchain/core/embeddings';
import type { AppConfig } from '../../../config/configuration';
import { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import { BaseLangChainEmbeddingProvider } from './base-langchain-embedding.provider';

@Injectable()
export class OpenAiEmbeddingProvider extends BaseLangChainEmbeddingProvider {
  readonly provider = EmbeddingProviderName.OPENAI;

  private readonly openai: AppConfig['embedding']['openai'];

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
    this.openai = embedding.openai;
  }

  get defaultModel(): string {
    return this.openai.model;
  }

  protected getClient(): Embeddings | null {
    if (!this.openai.apiKey) return null;
    return new OpenAIEmbeddings({
      apiKey: this.openai.apiKey,
      model: this.openai.model,
      dimensions: this.cfg.dimensions,
      maxRetries: 0,
      configuration: this.openai.baseUrl
        ? { baseURL: this.openai.baseUrl }
        : undefined,
    });
  }
}
