import { Injectable, Logger } from '@nestjs/common';
import type { RetrievedChunk } from '../../common/types';
import type { RerankResult } from './reranker.interface';
import {
  RerankerFactoryService,
  type RerankProviderName,
} from './reranker-factory.service';
import { NoopRerankerProvider } from './providers/noop-reranker.provider';

/**
 * Service reranking chính cho pipeline RAG (PROMPT §19, §54).
 *
 * Uỷ thác cho provider được cấu hình trong `RerankerFactoryService` (hoặc ghi đè).
 * Bắt MỌI lỗi và tự động fallback về NoopRerankerProvider (identity) để đảm bảo
 * không bao giờ làm hỏng pipeline truy vấn.
 */
@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);

  constructor(
    private readonly factory: RerankerFactoryService,
    private readonly noopProvider: NoopRerankerProvider,
  ) {}

  get activeProvider(): RerankProviderName {
    return this.factory.activeName;
  }

  /**
   * Rerank danh sách retrieved chunks.
   * KHÔNG BAO GIỜ ném exception (PROMPT §54).
   */
  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
    override?: string,
  ): Promise<RerankResult> {
    if (!chunks || chunks.length === 0) {
      return {
        chunks: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
        latencyMs: 0,
        method: 'none',
        fellBack: false,
      };
    }

    const t0 = Date.now();
    let targetMethod = override ?? 'none';

    try {
      const provider = this.factory.create(override);
      targetMethod = provider.name;

      const rawResult = await provider.rerank(query, chunks, topK);
      const rankedChunks = Array.isArray(rawResult)
        ? rawResult
        : rawResult.chunks;

      // Bảo vệ: Nếu provider trả < 1 chunk khi input có chunk
      if (!rankedChunks || rankedChunks.length === 0) {
        throw new Error(
          `Reranker '${targetMethod}' trả về danh sách rỗng khi input có ${chunks.length} chunks`,
        );
      }

      const usage = Array.isArray(rawResult)
        ? { inputTokens: 0, outputTokens: 0, estimatedCost: 0 }
        : {
            inputTokens: rawResult.usage?.inputTokens ?? 0,
            outputTokens: rawResult.usage?.outputTokens ?? 0,
            estimatedCost: rawResult.usage?.estimatedCost ?? 0,
          };

      return {
        chunks: rankedChunks,
        usage,
        latencyMs: Date.now() - t0,
        method: targetMethod,
        fellBack: false,
      };
    } catch (err) {
      this.logger.warn(
        `Reranker '${targetMethod}' gặp lỗi, fallback về identity: ${(err as Error)?.message}`,
      );

      const fallbackChunks = await this.noopProvider.rerank(
        query,
        chunks,
        topK,
      );

      // Token đã tốn cho lời gọi LLM thất bại KHÔNG được mất dấu (§38, §56).
      const spent = (err as { usage?: RerankResult['usage'] }).usage;

      return {
        chunks: fallbackChunks,
        usage: {
          inputTokens: spent?.inputTokens ?? 0,
          outputTokens: spent?.outputTokens ?? 0,
          estimatedCost: spent?.estimatedCost ?? 0,
        },
        latencyMs: Date.now() - t0,
        method: targetMethod,
        fellBack: true,
      };
    }
  }
}
