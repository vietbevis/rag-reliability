import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../config/configuration';
import type { Claim, TokenUsage } from '../../common/types';
import { LlmService } from '../../ai/llm/llm.service';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { contentTokens, looksLikeAbstention } from './grounding-checks';

export interface ClaimExtractionResult {
  claims: Claim[];
  provider: string | null;
  model: string | null;
  usage: TokenUsage;
  latencyMs: number;
  /** Nguồn: 'llm' | 'fallback-single' | 'skipped' (abstain/rỗng). */
  method: 'llm' | 'fallback-single' | 'skipped';
}

const CLAIM_SCHEMA = z.object({
  claims: z
    .array(z.object({ text: z.string() }))
    .max(40)
    .default([]),
});

const SYSTEM_PROMPT = `Bạn tách một CÂU TRẢ LỜI thành các khẳng định (claim) nguyên tử.

Quy tắc:
1. Mỗi claim là MỘT sự kiện độc lập, tự nó kiểm chứng được.
2. Giữ nguyên số liệu, tên riêng, mốc thời gian, điều kiện đúng như trong câu trả lời.
3. KHÔNG thêm thông tin không có trong câu trả lời. KHÔNG suy diễn.
4. Bỏ câu dẫn, lời chào, câu hỏi tu từ, ý kiến/nhận định không mang thông tin.
5. Nếu câu trả lời là lời từ chối ("không tìm thấy thông tin"...) → trả claims rỗng.
6. Câu trả lời một ý → một claim.

Trả JSON: { "claims": [ { "text": "..." }, ... ] }`;

/**
 * Tách câu trả lời thành các claim nguyên tử (PROMPT §24). Backend tự cấp id
 * (`c1`, `c2`, ...) — KHÔNG tin id/nhãn do LLM đặt (§29). Đối chiếu evidence là
 * việc của {@link EvidenceMatcherService}.
 */
@Injectable()
export class ClaimExtractorService {
  private readonly logger = new Logger(ClaimExtractorService.name);
  private readonly temperature: number;
  private readonly minAnswerTokens: number;

  constructor(
    private readonly llm: LlmService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.temperature = config.get('rag', { infer: true }).temperature;
    this.minAnswerTokens = config.get('citation', {
      infer: true,
    }).minAnswerTokens;
  }

  async extract(answer: string): Promise<ClaimExtractionResult> {
    const started = Date.now();
    const emptyUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    const trimmed = answer.trim();

    // Lời từ chối / rỗng → không có claim nào để trích dẫn.
    if (trimmed.length === 0 || looksLikeAbstention(trimmed)) {
      return {
        claims: [],
        provider: null,
        model: null,
        usage: emptyUsage,
        latencyMs: Date.now() - started,
        method: 'skipped',
      };
    }

    // Câu trả lời quá ngắn → coi là 1 claim = chính nó (khỏi tốn 1 lời gọi LLM).
    if (contentTokens(trimmed).size < this.minAnswerTokens) {
      return {
        claims: [{ id: 'c1', text: trimmed }],
        provider: null,
        model: null,
        usage: emptyUsage,
        latencyMs: Date.now() - started,
        method: 'fallback-single',
      };
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `CÂU TRẢ LỜI:\n${trimmed}` },
    ];

    const res = await this.llm.chatStructured(messages, CLAIM_SCHEMA, {
      temperature: this.temperature,
      traceLabel: 'rag.citation.claim-extract',
    });

    const claims = dedupeClaims(
      res.data.claims
        .map((c) => c.text.trim())
        .filter((t) => t.length > 0),
    );

    // LLM không tách được claim nào cho câu trả lời có nội dung → fallback 1 claim.
    if (claims.length === 0) {
      this.logger.debug('LLM trả 0 claim cho answer có nội dung — fallback single');
      return {
        claims: [{ id: 'c1', text: trimmed }],
        provider: res.provider,
        model: res.model,
        usage: res.usage,
        latencyMs: Date.now() - started,
        method: 'fallback-single',
      };
    }

    return {
      claims: claims.map((text, i) => ({ id: `c${i + 1}`, text })),
      provider: res.provider,
      model: res.model,
      usage: res.usage,
      latencyMs: Date.now() - started,
      method: 'llm',
    };
  }
}

function dedupeClaims(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const key = t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
