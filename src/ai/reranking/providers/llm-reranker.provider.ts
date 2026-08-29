import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RerankedChunk, RetrievedChunk } from '../../../common/types';
import { LlmFactoryService } from '../../llm/llm-factory.service';
import { LlmService } from '../../llm/llm.service';
import type { ChatMessage } from '../../llm/llm.interface';
import type {
  ProviderRerankResult,
  RerankerProvider,
} from '../reranker.interface';

/**
 * Reranker listwise sử dụng LLM qua `LlmService.chatStructured`.
 *
 * Gửi toàn bộ danh sách chunk đánh số [1..N] trong MỘT lời gọi LLM duy nhất,
 * yêu cầu LLM chấm điểm mức độ từng chunk trả lời được câu hỏi (0-10) chỉ dựa
 * trên nội dung chunk.
 *
 * Ghi chú: FakeLlmProvider trong CI mặc định sinh `ranking: []` cho mảng không
 * cấu hình riêng. Khi LLM_PROVIDER=fake, LlmRerankerProvider sẽ nhận `ranking: []`,
 * coi là không hợp lệ và ném lỗi để RerankerService fallback — điều này là đúng
 * thiết kế (CI dùng RERANK_PROVIDER=fake thay vì provider llm).
 */
@Injectable()
export class LlmRerankerProvider implements RerankerProvider {
  readonly name = 'llm';

  constructor(
    private readonly llm: LlmService,
    private readonly llmFactory: LlmFactoryService,
  ) {}

  isConfigured(): boolean {
    return this.llmFactory.create().isConfigured();
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<ProviderRerankResult> {
    if (chunks.length === 0) {
      return {
        chunks: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
      };
    }

    const maxChunks = chunks.length;
    const rankingSchema = z.object({
      ranking: z
        .array(
          z.object({
            index: z.number().int().min(1),
            relevance: z.number().min(0).max(10),
          }),
        )
        .max(maxChunks),
    });

    const formattedChunks = chunks
      .map((c, i) => `[${i + 1}] ${c.content.slice(0, 500)}`)
      .join('\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Bạn là chuyên gia đánh giá và xếp hạng tài liệu. Hãy chấm mức độ chunk TRẢ LỜI ĐƯỢC câu hỏi, 0-10; chỉ dựa trên nội dung chunk.',
      },
      {
        role: 'user',
        content: `Câu hỏi: ${query}\n\nDanh sách chunk:\n${formattedChunks}`,
      },
    ];

    const res = await this.llm.chatStructured(messages, rankingSchema);

    if (!res.data?.ranking || res.data.ranking.length === 0) {
      throw new Error('LLM reranker trả về ranking rỗng hoặc không hợp lệ');
    }

    const scoreMap = new Map<number, number>();
    for (const item of res.data.ranking) {
      scoreMap.set(item.index, item.relevance);
    }

    const mapped = chunks.map((chunk, originalIndex) => {
      const index1Based = originalIndex + 1;
      const relevance = scoreMap.get(index1Based) ?? 0;
      const rerankScore = relevance / 10;
      return { chunk, rerankScore, originalIndex };
    });

    // Sắp giảm dần theo rerankScore; chunk không được nhắc (relevance 0) xếp cuối;
    // giữ thứ tự ban đầu nếu cùng điểm
    mapped.sort((a, b) => {
      if (b.rerankScore !== a.rerankScore) {
        return b.rerankScore - a.rerankScore;
      }
      return a.originalIndex - b.originalIndex;
    });

    const rerankedChunks: RerankedChunk[] = mapped
      .slice(0, topK)
      .map((item, i) => ({
        ...item.chunk,
        rerankScore: item.rerankScore,
        rank: i,
      }));

    return {
      chunks: rerankedChunks,
      usage: {
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        estimatedCost: res.usage.estimatedCost,
      },
    };
  }
}
