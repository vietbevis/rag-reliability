import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type {
  Citation,
  FaithfulnessResult,
  RagStatus,
  RetrievedChunk,
  TokenUsage,
  VerifiedClaim,
} from '../../common/types';
import { ContextBuilderService } from '../context/context-builder.service';
import { AnswerGenerationService } from './answer-generation.service';
import { CitationService } from './citation.service';
import { ClaimExtractorService } from './claim-extractor.service';
import { EvidenceMatcherService } from './evidence-matcher.service';
import { FaithfulnessService } from './faithfulness.service';
import {
  applyNumericProvenance,
  resolveGroundedStatus,
} from './grounding-resolution';

/** Câu từ chối chuẩn khi không đủ căn cứ (đồng bộ với RagPipelineService). */
export const ABSTAIN_ANSWER =
  'Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi này.';

export interface VerificationResult {
  answer: string;
  status: RagStatus;
  claims: VerifiedClaim[];
  citations: Citation[];
  faithfulness: FaithfulnessResult | null;
  usage: TokenUsage;
}

const zeroUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
});

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

/**
 * Kiểm chứng một câu trả lời với tập chunk evidence (PROMPT §24-28): claim →
 * evidence (lexical) → citation → faithfulness verifier → numeric-provenance →
 * map `RagStatus`. Dùng bởi **agent `finalize`** (evidence từ tool result).
 *
 * `RagPipelineService` (/rag/query) KHÔNG gọi thẳng service này vì nó cần khớp
 * evidence theo **citation-marker của generator** (`usedContextChunkIds`) +
 * tối ưu tái dùng `gen.claims` — khác bản chất với agent. Hai bên **dùng chung
 * lõi** `grounding-resolution.ts` (numeric-provenance + map status) để không
 * lệch logic (PHASE 18 — hợp nhất phần thực sự chung).
 */
@Injectable()
export class AnswerVerificationService {
  private readonly logger = new Logger(AnswerVerificationService.name);
  private readonly faithThreshold: number;

  constructor(
    private readonly generation: AnswerGenerationService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly claimExtractor: ClaimExtractorService,
    private readonly evidenceMatcher: EvidenceMatcherService,
    private readonly citation: CitationService,
    private readonly faithfulness: FaithfulnessService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.faithThreshold = config.get('faithfulness', {
      infer: true,
    }).threshold;
  }

  /**
   * Dùng khi agent DỪNG SỚM mà chưa có câu trả lời: sinh câu trả lời chỉ từ
   * `chunks` rồi verify. `chunks` rỗng ⇒ abstain.
   */
  async synthesizeAndVerify(
    task: string,
    chunks: RetrievedChunk[],
  ): Promise<VerificationResult> {
    if (chunks.length === 0) {
      return this.abstain(zeroUsage());
    }
    const context = this.contextBuilder.build(chunks);
    const gen = await this.generation.generate(task, context, {});
    if (gen.status === 'INSUFFICIENT_EVIDENCE') {
      return this.abstain(gen.usage);
    }
    const verified = await this.verifyAnswer(gen.answer, chunks, gen.status);
    return { ...verified, usage: addUsage(verified.usage, gen.usage) };
  }

  /**
   * Verify một câu trả lời CÓ SẴN (agent đã tự tổng hợp). `initialStatus` là
   * điểm khởi đầu — thường `GROUNDED`, hoặc status của bước generation nếu có.
   */
  async verifyAnswer(
    answer: string,
    chunks: RetrievedChunk[],
    initialStatus: RagStatus = 'GROUNDED',
  ): Promise<VerificationResult> {
    const extraction = await this.claimExtractor.extract(answer);

    // Câu trả lời là lời từ chối / rỗng → không có gì để verify.
    if (extraction.method === 'skipped' || extraction.claims.length === 0) {
      return {
        answer,
        status:
          extraction.method === 'skipped'
            ? 'INSUFFICIENT_EVIDENCE'
            : initialStatus,
        claims: [],
        citations: [],
        faithfulness: { score: 1, grounded: true, claims: [] },
        usage: extraction.usage,
      };
    }

    if (chunks.length === 0) {
      // Có khẳng định nhưng không có evidence nào ⇒ không thể grounded.
      return {
        answer: ABSTAIN_ANSWER,
        status: 'INSUFFICIENT_EVIDENCE',
        claims: extraction.claims.map((c) => ({
          id: c.id,
          text: c.text,
          supported: false,
          verdict: 'UNSUPPORTED',
          evidenceChunkIds: [],
        })),
        citations: [],
        faithfulness: { score: 0, grounded: false, claims: [] },
        usage: extraction.usage,
      };
    }

    const evidence = this.evidenceMatcher.match(extraction.claims, chunks);
    const built = await this.citation.build(
      extraction.claims,
      evidence,
      chunks,
    );
    const faith = await this.faithfulness.verify(
      answer,
      extraction.claims,
      evidence,
      chunks,
      initialStatus,
      { threshold: this.faithThreshold },
    );

    const faithByClaim = new Map(
      faith.result.claims.map((e) => [e.claimId, e]),
    );
    const evByClaim = new Map(evidence.map((e) => [e.claimId, e]));
    const claims: VerifiedClaim[] = extraction.claims.map((c) => {
      const fe = faithByClaim.get(c.id);
      const le = evByClaim.get(c.id);
      return {
        id: c.id,
        text: c.text,
        supported: fe?.supported ?? le?.supported ?? false,
        verdict: fe?.verdict ?? le?.verdict ?? 'UNSUPPORTED',
        evidenceChunkIds: fe?.evidenceChunkIds ?? le?.evidenceChunkIds ?? [],
      };
    });

    // §9.3 numeric-provenance + map RagStatus — LÕI DÙNG CHUNG với RagPipelineService.
    const provCitations = applyNumericProvenance(claims, chunks);
    const status = resolveGroundedStatus({
      claims,
      faithGrounded: faith.result.grounded,
      faithRootCause: faith.result.rootCause,
      initialStatus,
    });

    return {
      answer: status === 'INSUFFICIENT_EVIDENCE' ? ABSTAIN_ANSWER : answer,
      status,
      claims,
      citations: [...built.citations, ...provCitations],
      faithfulness: faith.result,
      usage: addUsage(extraction.usage, faith.usage),
    };
  }

  private abstain(usage: TokenUsage): VerificationResult {
    return {
      answer: ABSTAIN_ANSWER,
      status: 'INSUFFICIENT_EVIDENCE',
      claims: [],
      citations: [],
      faithfulness: { score: 1, grounded: true, claims: [] },
      usage,
    };
  }
}
