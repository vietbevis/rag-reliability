import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../config/configuration';
import type {
  Claim,
  GroundingContext,
  RagStatus,
  TokenUsage,
} from '../../common/types';
import { LlmService } from '../../ai/llm/llm.service';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { ContextBuilderService } from '../context/context-builder.service';
import {
  contentTokens,
  lexicalGroundingRatio,
  resolveGroundingStatus,
} from './grounding-checks';

export interface GenerateOptions {
  /** Ghi đè `RAG_STRICT_GROUNDING` cho lần gọi này. */
  strict?: boolean;
}

export interface GeneratedAnswerResult {
  answer: string;
  status: RagStatus;
  /** Chỉ số 1-based của các chunk context được trích dẫn (theo LLM). */
  citedIndexes: number[];
  /** Ghi chú khi status = CONFLICTING_EVIDENCE. */
  conflictNote?: string;
  /**
   * Claim nguyên tử của answer do CHÍNH lời gọi generation trả về (gộp call —
   * docs/audit/ARCHITECTURE_REVIEW.md §5.3). Backend cấp id `c1..cn`. Rỗng khi
   * abstention hoặc model không trả claim (pipeline sẽ fallback ClaimExtractor).
   */
  claims: Claim[];
  /** Tỉ lệ token nội dung của answer xuất hiện trong context (proxy §23). */
  groundingRatio: number;
  /** Status cuối khác status LLM (bị hậu kiểm hạ xuống). */
  downgraded: boolean;
  /** Đã sinh lại 1 lần vì câu trả lời đầu không bám ngữ cảnh. */
  regenerated: boolean;
  provider: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

const GROUNDED_SCHEMA = z.object({
  answer: z.string(),
  status: z.enum([
    'GROUNDED',
    'PARTIALLY_GROUNDED',
    'INSUFFICIENT_EVIDENCE',
    'CONFLICTING_EVIDENCE',
  ]),
  usedContext: z.array(z.number().int().min(1)).default([]),
  /** LLM tự khẳng định MỌI câu trong answer đều có căn cứ trực tiếp trong context. */
  groundedInContext: z.boolean().default(true),
  /** Khi CONFLICTING_EVIDENCE: mô tả ngắn hai nguồn mâu thuẫn. */
  conflictNote: z.string().default(''),
  /** answer tách thành các khẳng định nguyên tử (gộp call claim-extraction). */
  claims: z
    .array(z.object({ text: z.string() }))
    .max(40)
    .default([]),
});

const REGEN_INSTRUCTION =
  'CÂU TRẢ LỜI TRƯỚC chưa bám sát ngữ cảnh (dùng từ ngữ / khẳng định không có ' +
  'trong các mục [i]). Trả lời LẠI: chỉ dùng thông tin có nguyên văn trong ngữ ' +
  'cảnh; nếu không đủ, đặt status = INSUFFICIENT_EVIDENCE.';

/**
 * Sinh câu trả lời có grounding (PROMPT §23-25).
 *
 * PHASE 4 baseline: prompt "chỉ từ context" + structured output + schema.parse.
 * PHASE 8: prompt siết chặt (abstention rõ ràng, CONFLICTING_EVIDENCE); **hậu
 * kiểm** answer↔context bằng `grounding-checks` (hàm thuần) — hạ status khi câu
 * trả lời tự mâu thuẫn / không bám ngữ cảnh; **sinh lại 1 lần** khi cần
 * (`RAG_REGENERATE_ON_UNGROUNDED`). KHÔNG phải faithfulness/claim-level (P10).
 */
@Injectable()
export class AnswerGenerationService {
  private readonly logger = new Logger(AnswerGenerationService.name);
  private readonly temperature: number;
  private readonly cfg: AppConfig['grounding'];

  constructor(
    private readonly llm: LlmService,
    private readonly contextBuilder: ContextBuilderService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.temperature = config.get('rag', { infer: true }).temperature;
    this.cfg = config.get('grounding', { infer: true });
  }

  async generate(
    question: string,
    context: GroundingContext,
    opts: GenerateOptions = {},
  ): Promise<GeneratedAnswerResult> {
    const strict = opts.strict ?? this.cfg.strict;
    const rendered = this.contextBuilder.renderContext(context);
    const nContext = context.chunks.length;
    const started = Date.now();

    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    let provider = '';
    let model = '';

    const runOnce = async (
      extra?: string,
    ): Promise<z.infer<typeof GROUNDED_SCHEMA>> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `NGỮ CẢNH (mỗi mục có số [i]):\n${rendered}\n\n` +
            `CÂU HỎI: ${question}\n\n` +
            `Trả JSON theo schema. "usedContext" = mảng số [i] bạn thực sự dùng.` +
            (extra ? `\n\n${extra}` : ''),
        },
      ];
      const res = await this.llm.chatStructured(messages, GROUNDED_SCHEMA, {
        temperature: this.temperature,
        traceLabel: 'rag.generate.grounded',
      });
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      usage.totalTokens += res.usage.totalTokens;
      usage.estimatedCost += res.usage.estimatedCost;
      provider = res.provider;
      model = res.model;
      return res.data;
    };

    let data = await runOnce();
    let regenerated = false;

    let resolved = this.resolve(data, strict, rendered);
    if (resolved.regenerate && strict && this.cfg.regenerateOnUngrounded) {
      this.logger.debug(
        `Sinh lại 1 lần (grounding yếu: ${resolved.reason ?? '?'})`,
      );
      data = await runOnce(REGEN_INSTRUCTION);
      regenerated = true;
      resolved = this.resolve(data, strict, rendered);
    }

    const citedIndexes = [...new Set(data.usedContext)]
      .filter((i) => i >= 1 && i <= nContext)
      .sort((a, b) => a - b);

    // Chỉ giữ claim khi status là câu trả lời thực (không phải abstention) —
    // nhất quán với ClaimExtractor (từ chối → 0 claim).
    const answerable =
      resolved.status === 'GROUNDED' ||
      resolved.status === 'PARTIALLY_GROUNDED' ||
      resolved.status === 'CONFLICTING_EVIDENCE';
    const claims: Claim[] = answerable
      ? dedupeClaimTexts(
          (data.claims ?? []).map((c) => c.text.trim()).filter(Boolean),
        ).map((text, i) => ({ id: `c${i + 1}`, text }))
      : [];

    return {
      answer: data.answer.trim(),
      status: resolved.status,
      citedIndexes,
      claims,
      conflictNote:
        resolved.status === 'CONFLICTING_EVIDENCE'
          ? data.conflictNote.trim() || undefined
          : undefined,
      groundingRatio: resolved.groundingRatio,
      downgraded: resolved.downgraded,
      regenerated,
      provider,
      model,
      usage,
      latencyMs: Date.now() - started,
    };
  }

  private resolve(
    data: z.infer<typeof GROUNDED_SCHEMA>,
    strict: boolean,
    contextText: string,
  ): {
    status: RagStatus;
    downgraded: boolean;
    regenerate: boolean;
    reason?: string;
    groundingRatio: number;
  } {
    const groundingRatio = lexicalGroundingRatio(data.answer, contextText);
    const r = resolveGroundingStatus({
      llmStatus: data.status,
      answer: data.answer,
      usedContextCount: new Set(data.usedContext).size,
      groundedSelfReport: data.groundedInContext,
      lexicalRatio: groundingRatio,
      minRatio: this.cfg.minGroundingRatio,
      strict,
      answerTokenCount: contentTokens(data.answer).size,
    });
    return { ...r, groundingRatio };
  }
}

/** Khử trùng claim theo dạng chuẩn hoá (giữ thứ tự xuất hiện). */
function dedupeClaimTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const key = t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

const SYSTEM_PROMPT = `Bạn trả lời câu hỏi CHỈ dựa trên NGỮ CẢNH được cung cấp.

Quy tắc bắt buộc:
1. Không bịa sự kiện. Không dùng kiến thức ngoài ngữ cảnh. Không đoán, không suy
   luận vượt quá điều ngữ cảnh nói.
2. Mọi khẳng định trong câu trả lời phải truy được về một mục [i] cụ thể.
3. Nếu ngữ cảnh KHÔNG chứa đủ thông tin để trả lời: status = INSUFFICIENT_EVIDENCE,
   answer nói rõ "Không tìm thấy thông tin trong tài liệu" — KHÔNG cố trả lời.
4. Nếu chỉ trả lời được một phần: status = PARTIALLY_GROUNDED.
5. Nếu ngữ cảnh chứa hai thông tin MÂU THUẪN nhau về cùng một điều:
   status = CONFLICTING_EVIDENCE, "conflictNote" mô tả ngắn hai nguồn, answer nêu
   cả hai và chỉ rõ chúng mâu thuẫn.
6. "usedContext" chỉ liệt kê số [i] bạn thực sự dùng — không tạo trích dẫn giả.
7. "groundedInContext" = true CHỈ khi mọi câu trong answer đều có căn cứ trực
   tiếp, nguyên văn trong các mục đã trích; ngược lại đặt false.
8. "claims" = tách CHÍNH answer của bạn thành các khẳng định nguyên tử, mỗi phần
   tử là MỘT sự kiện độc lập tự kiểm chứng được, giữ nguyên số liệu/tên riêng/mốc
   thời gian. KHÔNG thêm thông tin ngoài answer. Nếu status = INSUFFICIENT_EVIDENCE
   → "claims" rỗng.

Trả JSON: { "answer", "status", "usedContext": [1,2], "groundedInContext": bool,
"conflictNote": "", "claims": [{ "text": "..." }] }`;
