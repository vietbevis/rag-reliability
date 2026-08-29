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
}

/**
 * Kiểm tra context TRƯỚC generation (PROMPT §22, §30). Nếu không đủ evidence
 * thì trả `INSUFFICIENT_EVIDENCE` và **không gọi LLM**.
 *
 * PHASE 4 baseline: chỉ abstain khi số chunk < `RAG_MIN_CHUNKS` hoặc điểm chunk
 * tốt nhất < `RAG_MIN_RELEVANCE` (mặc định 0 → chỉ chặn khi rỗng). PHASE 7 siết
 * chặt (ngưỡng relevance thật, phát hiện conflicting).
 */
@Injectable()
export class ContextValidatorService {
  private readonly minChunks: number;
  private readonly minRelevance: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const rag = config.get('rag', { infer: true });
    this.minChunks = rag.minChunks;
    this.minRelevance = rag.minRelevance;
  }

  validate(context: GroundingContext): ContextValidation {
    const topScore = context.chunks[0]?.score ?? null;

    if (context.chunks.length < this.minChunks) {
      return {
        proceed: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `Chỉ có ${context.chunks.length} chunk (< ${this.minChunks})`,
        topScore,
      };
    }
    if (topScore !== null && topScore < this.minRelevance) {
      return {
        proceed: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `Điểm liên quan cao nhất ${topScore} < ngưỡng ${this.minRelevance}`,
        topScore,
      };
    }
    return { proceed: true, status: 'OK', topScore };
  }
}
