import { Injectable } from '@nestjs/common';
import { EmbeddingProviderName } from '../llm/llm-provider.enum';
import { EmbeddingFactoryService } from './embedding-factory.service';
import type {
  EmbeddingBatchResult,
  EmbeddingResult,
} from './embedding.interface';

/**
 * Điểm vào embedding thống nhất cho lõi RAG. Độc lập với provider: đổi
 * `EMBEDDING_PROVIDER` là đổi back-end mà không cần sửa code (PROMPT §14).
 */
@Injectable()
export class EmbeddingService {
  constructor(private readonly factory: EmbeddingFactoryService) {}

  get activeProvider(): EmbeddingProviderName {
    return this.factory.defaultProviderName;
  }

  get dimensions(): number {
    return this.factory.create().dimensions;
  }

  embed(
    text: string,
    provider?: EmbeddingProviderName,
  ): Promise<EmbeddingResult> {
    return this.factory.create(provider).embed(text);
  }

  embedBatch(
    texts: string[],
    provider?: EmbeddingProviderName,
  ): Promise<EmbeddingBatchResult> {
    return this.factory.create(provider).embedBatch(texts);
  }
}
