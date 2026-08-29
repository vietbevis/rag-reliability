import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import type { TokenUsage } from '../../common/types';

const JUDGE_SCHEMA = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});

export interface JudgeResult {
  score: number;
  reasoning: string;
  usage: TokenUsage;
}

/**
 * Chấm "answer correctness" bằng LLM-judge (PROMPT §34): so câu trả lời thực tế
 * với `expectedAnswer`, không nhìn ngữ cảnh retrieval. Đây là chỉ số **tham
 * khảo** ở baseline — PHASE 10 sẽ có evaluator faithfulness/relevance chuẩn.
 *
 * Trả `null` khi không có `expectedAnswer` hoặc provider LLM chưa cấu hình
 * (chạy được eval retrieval-only mà không cần key).
 */
@Injectable()
export class AnswerJudgeService {
  private readonly logger = new Logger(AnswerJudgeService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly llmFactory: LlmFactoryService,
  ) {}

  isAvailable(): boolean {
    return this.llmFactory.create().isConfigured();
  }

  async judge(
    question: string,
    expectedAnswer: string | null,
    actualAnswer: string | null,
  ): Promise<JudgeResult | null> {
    if (!expectedAnswer || !this.isAvailable()) return null;
    if (!actualAnswer) {
      return {
        score: 0,
        reasoning: 'Không có câu trả lời',
        usage: emptyUsage(),
      };
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `CÂU HỎI: ${question}\n\n` +
          `ĐÁP ÁN CHUẨN: ${expectedAnswer}\n\n` +
          `CÂU TRẢ LỜI CẦN CHẤM: ${actualAnswer}\n\n` +
          'Chấm điểm 0.0–1.0 mức độ câu trả lời khớp về mặt nội dung với đáp án chuẩn.',
      },
    ];

    try {
      const res = await this.llm.chatStructured(messages, JUDGE_SCHEMA, {
        temperature: 0,
        traceLabel: 'eval.judge.answer-correctness',
      });
      return {
        score: res.data.score,
        reasoning: res.data.reasoning,
        usage: res.usage,
      };
    } catch (err) {
      this.logger.warn(
        `LLM-judge lỗi, bỏ qua answer-correctness: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
}

const SYSTEM_PROMPT = `Bạn là giám khảo chấm câu trả lời cho hệ thống hỏi đáp.

Chấm CÂU TRẢ LỜI CẦN CHẤM so với ĐÁP ÁN CHUẨN, chỉ xét nội dung thông tin:
- 1.0: nêu đúng và đủ mọi thông tin quan trọng của đáp án chuẩn.
- 0.5: đúng một phần / thiếu thông tin.
- 0.0: sai, mâu thuẫn, hoặc từ chối trả lời trong khi đáp án chuẩn có nội dung.
Bỏ qua khác biệt về cách diễn đạt. Trả JSON: { "score": number, "reasoning": "..." }`;
