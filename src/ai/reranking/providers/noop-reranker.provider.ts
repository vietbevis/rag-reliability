import { Injectable } from '@nestjs/common';
import type { RerankedChunk, RetrievedChunk } from '../../../common/types';
import type { RerankerProvider } from '../reranker.interface';

/**
 * Baseline no-op reranker: giữ nguyên thứ tự ban đầu, gán `rerankScore = chunk.score`,
 * gán `rank = i` và cắt theo `topK`. Dùng làm baseline và fallback an toàn khi
 * các provider khác gặp sự cố (PROMPT §19, §54).
 */
@Injectable()
export class NoopRerankerProvider implements RerankerProvider {
  readonly name = 'none';

  isConfigured(): boolean {
    return true;
  }

  rerank(
    _query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<RerankedChunk[]> {
    const result = chunks.slice(0, topK).map((chunk, i) => ({
      ...chunk,
      rerankScore: chunk.score,
      rank: i,
    }));
    return Promise.resolve(result);
  }
}
