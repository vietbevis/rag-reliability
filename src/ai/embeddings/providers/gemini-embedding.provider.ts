import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { Embeddings } from '@langchain/core/embeddings';
import type { AppConfig } from '../../../config/configuration';
import { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import { BaseLangChainEmbeddingProvider } from './base-langchain-embedding.provider';

@Injectable()
export class GeminiEmbeddingProvider extends BaseLangChainEmbeddingProvider {
  readonly provider = EmbeddingProviderName.GEMINI;

  private readonly gemini: AppConfig['embedding']['gemini'];

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
    this.gemini = embedding.gemini;
  }

  get defaultModel(): string {
    return this.gemini.model;
  }

  protected getClient(): Embeddings | null {
    if (!this.gemini.apiKey) return null;
    return new GoogleGenerativeAIEmbeddings({
      apiKey: this.gemini.apiKey,
      model: this.gemini.model,
    });
  }
}
