import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { GroundingContext, RagStatus } from '../../common/types';

export interface ContextValidation {
  /** Có nên gọi LLM generation không. */
  proceed: boolean;
  /** Khi không proceed: lý do abstain. */
  status: Extract<RagStatus, 'INSUFFICIENT_EVIDENCE'> | 'OK';
  reason?: string;
  topScore: number | null;
  /** Chế độ đã áp dụng (để trace). */
  strict: boolean;
}

/**
 * Kiểm tra context TRƯỚC generation (PROMPT §22, §30). Không đủ evidence →
 * `INSUFFICIENT_EVIDENCE` và **không gọi LLM**.
 *
 * - **baseline** (`RAG_STRICT_GROUNDING=false`): chỉ abstain khi số chunk <
 *   `RAG_MIN_CHUNKS` (mặc định 1 → chặn khi rỗng) hoặc topScore <
 *   `RAG_MIN_RELEVANCE` (mặc định 0). Giữ hallucination đo được (§35).
 * - **strict** (PHASE 8): thêm — abstain khi topScore <
 *   `RAG_ABSTAIN_MIN_RELEVANCE`.
 */
@Injectable()
export class ContextValidatorService {
  private readonly minChunks: number;
  private readonly minRelevance: number;
  private readonly strictDefault: boolean;
  private readonly abstainMinRelevance: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const rag = config.get('rag', { infer: true });
    const grounding = config.get('grounding', { infer: true });
    this.minChunks = rag.minChunks;
    this.minRelevance = rag.minRelevance;
    this.strictDefault = grounding.strict;
    this.abstainMinRelevance = grounding.abstainMinRelevance;
  }

  validate(context: GroundingContext, strict?: boolean): ContextValidation {
    const isStrict = strict ?? this.strictDefault;
    const topScore = context.chunks[0]?.score ?? null;
    const base = { topScore, strict: isStrict };

    if (context.chunks.length < this.minChunks) {
      return {
        ...base,
        proceed: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `Chỉ có ${context.chunks.length} chunk (< ${this.minChunks})`,
      };
    }

    const relevanceFloor = isStrict
      ? Math.max(this.minRelevance, this.abstainMinRelevance)
      : this.minRelevance;
    if (topScore !== null && topScore < relevanceFloor) {
      return {
        ...base,
        proceed: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `Điểm liên quan cao nhất ${topScore} < ngưỡng ${relevanceFloor}${
          isStrict ? ' (strict)' : ''
        }`,
      };
    }

    return { ...base, proceed: true, status: 'OK' };
  }
}
