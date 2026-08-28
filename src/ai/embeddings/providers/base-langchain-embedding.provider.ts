import { Logger } from '@nestjs/common';
import type { Embeddings } from '@langchain/core/embeddings';
import { EmbeddingError } from '../../../common/errors';
import type { TokenUsage } from '../../../common/types';
import { chunkArray } from '../../../common/utils';
import type { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import { classifyProviderError, withRetry } from '../../llm/retry.util';
import type {
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingResult,
} from '../embedding.interface';

export interface BaseEmbeddingConfig {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  batchSize: number;
  dimensions: number;
}

/**
 * Hiện thực dùng chung của {@link EmbeddingProvider} dựa trên bất kỳ
 * `Embeddings` nào của LangChain. Xử lý thống nhất việc chia lô, retry,
 * timeout, kiểm tra số chiều và kế toán token (ước tính) (PROMPT §14, §52, §55).
 */
export abstract class BaseLangChainEmbeddingProvider implements EmbeddingProvider {
  protected readonly logger: Logger;

  abstract readonly provider: EmbeddingProviderName;
  abstract readonly defaultModel: string;

  protected constructor(protected readonly cfg: BaseEmbeddingConfig) {
    this.logger = new Logger(this.constructor.name);
  }

  get dimensions(): number {
    return this.cfg.dimensions;
  }

  protected abstract getClient(): Embeddings | null;

  isConfigured(): boolean {
    return this.getClient() !== null;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const batch = await this.embedBatch([text]);
    const vector = batch.vectors[0];
    if (!vector) {
      throw new EmbeddingError(
        'UNKNOWN',
        'Embedding provider returned no vector',
      );
    }
    return { vector, usage: batch.usage, model: batch.model };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
    const client = this.getClient();
    if (!client) {
      throw new EmbeddingError(
        'AUTH',
        `${this.provider} embedding provider is not configured`,
        { provider: this.provider },
      );
    }
    if (texts.length === 0) {
      return { vectors: [], usage: emptyUsage(), model: this.defaultModel };
    }

    const vectors: number[][] = [];
    for (const slice of chunkArray(texts, this.cfg.batchSize)) {
      const { value } = await withRetry(() => client.embedDocuments(slice), {
        label: `embedding.${this.provider}`,
        maxRetries: this.cfg.maxRetries,
        baseDelayMs: this.cfg.retryBaseDelayMs,
        timeoutMs: this.cfg.timeoutMs,
        logger: this.logger,
      }).catch((err) => {
        const { kind, retryable } = classifyProviderError(err);
        throw new EmbeddingError(
          kind,
          `${this.provider} embedding failed: ${(err as Error)?.message ?? 'unknown'}`,
          { provider: this.provider },
          { cause: err, retryable },
        );
      });
      vectors.push(...value);
    }

    this.verifyDimensions(vectors);

    return {
      vectors,
      usage: this.estimateUsage(texts),
      model: this.defaultModel,
    };
  }

  private verifyDimensions(vectors: number[][]): void {
    const wrong = vectors.find((v) => v.length !== this.cfg.dimensions);
    if (wrong) {
      throw new EmbeddingError(
        'BAD_REQUEST',
        `Embedding dimension mismatch: expected ${this.cfg.dimensions}, got ${wrong.length}. ` +
          `Set EMBEDDING_DIMENSION to match ${this.defaultModel}.`,
        {
          provider: this.provider,
          expected: this.cfg.dimensions,
          got: wrong.length,
        },
      );
    }
  }

  /**
   * API embedding hiếm khi trả về token usage; ước lượng bằng heuristic
   * chars/4 để việc theo dõi chi phí không bao giờ trống. Sẽ tinh chỉnh ở các
   * phase sau.
   */
  protected estimateUsage(texts: string[]): TokenUsage {
    const inputTokens = texts.reduce(
      (sum, t) => sum + Math.ceil(t.length / 4),
      0,
    );
    return {
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      estimatedCost: 0,
    };
  }
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
}
