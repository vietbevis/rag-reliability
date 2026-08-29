import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../config/configuration';
import type {
  GroundingContext,
  RagStatus,
  TokenUsage,
} from '../../common/types';
import { LlmService } from '../../ai/llm/llm.service';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { ContextBuilderService } from '../context/context-builder.service';

export interface GeneratedAnswerResult {
  answer: string;
  status: RagStatus;
  /** Chỉ số 1-based của các chunk context được trích dẫn (theo LLM). */
  citedIndexes: number[];
  provider: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

const BASELINE_SCHEMA = z.object({
  answer: z.string(),
  status: z.enum(['GROUNDED', 'PARTIALLY_GROUNDED', 'INSUFFICIENT_EVIDENCE']),
  usedContext: z.array(z.number().int().min(1)).default([]),
});

/**
 * Sinh câu trả lời có grounding (PROMPT §23).
 *
 * PHASE 4 = **baseline**: một prompt yêu cầu trả lời CHỈ từ context + xuất
 * structured JSON, nhưng chưa có claim extraction / evidence matching /
 * abstention nghiêm ngặt (PHASE 7-9). Mục tiêu là có mốc để đo hallucination.
 * Output luôn validate server-side (§23, §50).
 */
@Injectable()
export class AnswerGenerationService {
  private readonly temperature: number;

  constructor(
    private readonly llm: LlmService,
    private readonly contextBuilder: ContextBuilderService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.temperature = config.get('rag', { infer: true }).temperature;
  }

  async generate(
    question: string,
    context: GroundingContext,
  ): Promise<GeneratedAnswerResult> {
    const rendered = this.contextBuilder.renderContext(context);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `NGỮ CẢNH (mỗi mục có số [i]):\n${rendered}\n\n` +
          `CÂU HỎI: ${question}\n\n` +
          `Trả lời JSON theo schema. "usedContext" là mảng số [i] bạn thực sự dùng.`,
      },
    ];

    const res = await this.llm.chatStructured(messages, BASELINE_SCHEMA, {
      temperature: this.temperature,
      traceLabel: 'rag.generate.baseline',
    });

    const nContext = context.chunks.length;
    const citedIndexes = [...new Set(res.data.usedContext)]
      .filter((i) => i >= 1 && i <= nContext)
      .sort((a, b) => a - b);

    return {
      answer: res.data.answer.trim(),
      status: res.data.status,
      citedIndexes,
      provider: res.provider,
      model: res.model,
      usage: res.usage,
      latencyMs: res.latencyMs,
    };
  }
}

const SYSTEM_PROMPT = `Bạn trả lời câu hỏi CHỈ dựa trên ngữ cảnh được cung cấp.

Quy tắc:
1. Không bịa sự kiện. Không dùng kiến thức ngoài ngữ cảnh.
2. Không đoán, không suy luận vượt quá điều ngữ cảnh nói.
3. Mọi khẳng định phải có căn cứ trong ngữ cảnh.
4. Nếu ngữ cảnh không đủ để trả lời, đặt status = INSUFFICIENT_EVIDENCE và nói rõ là không tìm thấy thông tin.
5. Nếu chỉ trả lời được một phần, status = PARTIALLY_GROUNDED.
6. Không tạo trích dẫn giả — chỉ liệt kê số [i] của mục ngữ cảnh bạn thực sự dùng.

Trả về JSON: { "answer": "...", "status": "GROUNDED|PARTIALLY_GROUNDED|INSUFFICIENT_EVIDENCE", "usedContext": [1,2] }`;
