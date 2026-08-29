import { Injectable } from '@nestjs/common';
import type { RerankedChunk, RetrievedChunk } from '../../../common/types';
import type { RerankerProvider } from '../reranker.interface';

/**
 * Tách text thành các token chữ/số (hỗ trợ Unicode tiếng Việt).
 */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
}

/**
 * Reranker tất định CHỈ DÙNG CHO CI / kiểm thử (không gọi LLM thật).
 *
 * Chấm điểm từng chunk dựa trên tỷ lệ trùng khớp token giữa query và nội dung
 * chunk (chuẩn hoá [0, 1]). Sắp xếp giảm dần theo điểm, cắt topK và gán rank.
 */
@Injectable()
export class FakeRerankerProvider implements RerankerProvider {
  readonly name = 'fake';

  isConfigured(): boolean {
    return true;
  }

  rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<RerankedChunk[]> {
    const queryTokens = new Set(tokenize(query));

    const scored = chunks.map((chunk, originalIndex) => {
      let score = 0;
      if (queryTokens.size > 0) {
        const chunkTokens = new Set(tokenize(chunk.content));
        let overlap = 0;
        for (const token of queryTokens) {
          if (chunkTokens.has(token)) {
            overlap++;
          }
        }
        score = overlap / queryTokens.size;
      }
      return { chunk, score, originalIndex };
    });

    // Sắp xếp giảm dần theo điểm; nếu bằng điểm giữ nguyên thứ tự ban đầu
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.originalIndex - b.originalIndex;
    });

    const result = scored.slice(0, topK).map((item, i) => ({
      ...item.chunk,
      rerankScore: item.score,
      rank: i,
    }));

    return Promise.resolve(result);
  }
}
