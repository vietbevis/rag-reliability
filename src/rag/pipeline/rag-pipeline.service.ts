import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppError, EmbeddingError } from '../../common/errors';
import type {
  Citation,
  Claim,
  Evidence,
  FaithfulnessResult,
  RagStatus,
  RetrievalFilters,
  RetrievedChunk,
  VerifiedClaim,
} from '../../common/types';
import {
  Prisma,
  RagStatus as RagStatusEnum,
} from '../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { sanitizeTrace } from '../../common/observability/trace-sanitizer.util';
import { RerankerService } from '../../ai/reranking/reranker.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ContextBuilderService } from '../context/context-builder.service';
import { ContextValidatorService } from '../context/context-validator.service';
import { AnswerGenerationService } from '../grounding/answer-generation.service';
import { ClaimExtractorService } from '../grounding/claim-extractor.service';
import { EvidenceMatcherService } from '../grounding/evidence-matcher.service';
import { CitationService } from '../grounding/citation.service';
import { FaithfulnessService } from '../grounding/faithfulness.service';

export interface RagQueryRequest {
  query: string;
  topK?: number;
  filters?: RetrievalFilters;
  strategy?: 'vector' | 'keyword' | 'graph' | 'hybrid';
  /** Ghi đè `RERANK_ENABLED` cho request này (benchmark before/after). */
  rerank?: boolean;
  /** Ghi đè `RAG_STRICT_GROUNDING` cho request này (benchmark before/after). */
  strict?: boolean;
  /** Ghi đè `RAG_CITATION_ENABLED` — tách claim + đối chiếu evidence + citation. */
  cite?: boolean;
  /** Ghi đè `RAG_FAITHFULNESS_ENABLED` — kiểm chứng trung thực & mâu thuẫn NLI. */
  faithfulness?: boolean;
}

export interface RagQueryOptions {
  /**
   * `true` (biên API): sau khi ghi `RagQuery.error`, ném lại lỗi hạ tầng để
   * `AllExceptionsFilter` trả HTTP đúng (502/503) — không để LB/monitor tưởng
   * service khoẻ (PROMPT §54, §38). `false` (eval/programmatic): nuốt lỗi, trả
   * `status: 'ERROR'` để caller ghi nhận từng case mà không vỡ cả run.
   */
  rethrow?: boolean;
}

export interface RagQueryResult {
  id: string;
  query: string;
  status: RagStatus | 'ERROR';
  answer: string | null;
  citations: Citation[];
  claims: VerifiedClaim[];
  faithfulness: FaithfulnessResult | null;
  retrieval: {
    strategy: string;
    chunkCount: number;
    topScore: number | null;
    chunks: Array<{
      chunkId: string;
      documentId: string;
      score: number;
      source: string;
      heading?: string;
      section?: string;
      page?: number;
    }>;
  };
  provider: string | null;
  model: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    estimatedCost: number;
  };
  latencyMs: number;
  error?: string;
  trace: Record<string, unknown>;
}

const ABSTAIN_ANSWER =
  'Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi này.';

/**
 * Pipeline truy vấn RAG (PROMPT §41).
 *   query → retrieve → rerank → context build → context validation
 *         → generate → claim extraction → evidence matching
 *         → faithfulness verifier (PHASE 10) → citation build
 *         → persist RagQuery + trace
 */
@Injectable()
export class RagPipelineService {
  private readonly logger = new Logger(RagPipelineService.name);
  private readonly rerankCfg: AppConfig['rerank'];
  private readonly citationCfg: AppConfig['citation'];
  private readonly faithfulnessCfg: AppConfig['faithfulness'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly reranker: RerankerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly contextValidator: ContextValidatorService,
    private readonly generation: AnswerGenerationService,
    private readonly claimExtractor: ClaimExtractorService,
    private readonly evidenceMatcher: EvidenceMatcherService,
    private readonly citation: CitationService,
    private readonly faithfulnessVerifier: FaithfulnessService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.rerankCfg = config.get('rerank', { infer: true });
    this.citationCfg = config.get('citation', { infer: true });
    this.faithfulnessCfg = config.get('faithfulness', { infer: true });
  }

  async query(
    req: RagQueryRequest,
    opts: RagQueryOptions = {},
  ): Promise<RagQueryResult> {
    const t0 = Date.now();
    const ragQuery = await this.prisma.ragQuery.create({
      data: { query: req.query },
    });

    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      estimatedCost: 0,
    };
    const trace: Record<string, unknown> = {};

    try {
      const rerankOn = req.rerank ?? this.rerankCfg.enabled;
      const finalTopK = req.topK ?? this.rerankCfg.topK;
      // Rerank bật → kéo nhiều ứng viên rồi mới thu về finalTopK (nhưng không ít
      // hơn finalTopK nếu client yêu cầu topK > RERANK_CANDIDATES).
      const retrieveTopK = rerankOn
        ? Math.max(this.rerankCfg.candidates, finalTopK)
        : finalTopK;

      const retrieval = await this.retrieval.retrieve({
        query: req.query,
        topK: retrieveTopK,
        filters: req.filters,
        strategy: req.strategy,
        ragQueryId: ragQuery.id,
      });
      usage.embeddingTokens += retrieval.usage.embeddingTokens;
      usage.estimatedCost += retrieval.usage.estimatedCost;
      trace.retrieval = retrieval.trace;

      // Lỗi hạ tầng truy hồi (vd embed query fail) KHÔNG được biến thành
      // "không đủ evidence" — ném để thành ERROR/502 (PROMPT §54).
      if (retrieval.error) {
        throw new EmbeddingError(
          'UNKNOWN',
          `Truy hồi thất bại (không phải do thiếu tài liệu): ${retrieval.error}`,
        );
      }

      // --- Rerank (PHASE 7) ------------------------------------------
      // Reranker KHÔNG bao giờ ném; lỗi → fallback identity (§54). Sau rerank,
      // `score` = `rerankScore` (điểm liên quan sau cùng) để ContextBuilder sắp
      // theo đúng thứ tự reranker và ContextValidator so ngưỡng cho đúng.
      let workingChunks: RetrievedChunk[] = retrieval.chunks;
      if (rerankOn && retrieval.chunks.length > 0) {
        const rr = await this.reranker.rerank(
          req.query,
          retrieval.chunks,
          finalTopK,
        );
        workingChunks = rr.chunks.map((c) => ({ ...c, score: c.rerankScore }));
        usage.inputTokens += rr.usage.inputTokens;
        usage.outputTokens += rr.usage.outputTokens;
        usage.estimatedCost += rr.usage.estimatedCost;
        trace.rerank = {
          enabled: true,
          method: rr.method,
          fellBack: rr.fellBack,
          in: retrieval.chunks.length,
          out: rr.chunks.length,
          latencyMs: rr.latencyMs,
        };
      } else {
        trace.rerank = { enabled: rerankOn };
      }

      const context = this.contextBuilder.build(workingChunks);
      trace.context = {
        chunks: context.chunks.length,
        totalTokens: context.totalTokens,
      };

      const validation = this.contextValidator.validate(context, req.strict);
      trace.validation = validation;

      let status: RagStatus | 'ERROR';
      let answer: string | null;
      let provider: string | null = null;
      let model: string | null = null;
      let citations: Citation[] = [];
      let claims: VerifiedClaim[] = [];
      let faithfulnessResult: FaithfulnessResult | null = null;

      if (!validation.proceed) {
        status = 'INSUFFICIENT_EVIDENCE';
        answer = ABSTAIN_ANSWER;
        faithfulnessResult = {
          score: 1.0,
          grounded: true,
          claims: [],
        };
      } else {
        const gen = await this.generation.generate(req.query, context, {
          strict: req.strict,
        });
        status = gen.status;
        // Hậu kiểm hạ về INSUFFICIENT_EVIDENCE → dùng câu abstain chuẩn.
        answer =
          status === 'INSUFFICIENT_EVIDENCE' ? ABSTAIN_ANSWER : gen.answer;
        provider = gen.provider;
        model = gen.model;
        usage.inputTokens += gen.usage.inputTokens;
        usage.outputTokens += gen.usage.outputTokens;
        usage.estimatedCost += gen.usage.estimatedCost;
        trace.generation = {
          latencyMs: gen.latencyMs,
          citedIndexes: gen.citedIndexes,
          groundingRatio: gen.groundingRatio,
          downgraded: gen.downgraded,
          regenerated: gen.regenerated,
          conflictNote: gen.conflictNote,
        };

        if (status === 'INSUFFICIENT_EVIDENCE') {
          citations = [];
          faithfulnessResult = {
            score: 1.0,
            grounded: true,
            claims: [],
          };
        } else {
          const shouldCite = req.cite ?? this.citationCfg.enabled;
          const shouldVerifyFaithfulness =
            req.faithfulness ?? this.faithfulnessCfg.enabled;

          if (shouldCite || shouldVerifyFaithfulness) {
            // --- Citation cấp claim (PHASE 9, §24-25, §29) -----------------
            const cite = await this.runCitation(
              gen.answer,
              gen.citedIndexes,
              context.chunks,
            );
            citations = cite.citations;
            claims = cite.claims;
            usage.inputTokens += cite.usage.inputTokens;
            usage.outputTokens += cite.usage.outputTokens;
            usage.estimatedCost += cite.usage.estimatedCost;
            trace.citation = cite.trace;

            // --- Faithfulness Verifier & Contradiction (PHASE 10, §26-28) ---
            if (shouldVerifyFaithfulness) {
              const rawClaims = cite.rawClaims;
              const rawEvidence = cite.rawEvidence;
              const faithExec = await this.faithfulnessVerifier.verify(
                gen.answer,
                rawClaims,
                rawEvidence,
                context.chunks,
                status,
                { threshold: this.faithfulnessCfg.threshold },
              );

              faithfulnessResult = faithExec.result;
              usage.inputTokens += faithExec.usage.inputTokens;
              usage.outputTokens += faithExec.usage.outputTokens;
              usage.estimatedCost += faithExec.usage.estimatedCost;
              trace.faithfulness = {
                score: faithExec.result.score,
                grounded: faithExec.result.grounded,
                rootCause: faithExec.result.rootCause,
                method: faithExec.method,
                latencyMs: faithExec.latencyMs,
              };

              // Đồng bộ verdict từ faithfulness verifier sang claims trả về
              const faithEvByClaim = new Map(
                faithExec.result.claims.map((e) => [e.claimId, e]),
              );
              claims = claims.map((c) => {
                const fe = faithEvByClaim.get(c.id);
                return fe
                  ? {
                      ...c,
                      supported: fe.supported,
                      verdict: fe.verdict,
                      evidenceChunkIds: fe.evidenceChunkIds,
                    }
                  : c;
              });

              // Xử lý mâu thuẫn hoặc không grounded
              const hasContradiction = claims.some(
                (c) => c.verdict === 'CONTRADICTED',
              );
              if (
                hasContradiction ||
                faithExec.result.rootCause === 'CONFLICTING_CONTEXT'
              ) {
                status = 'CONFLICTING_EVIDENCE';
              } else if (
                !faithExec.result.grounded &&
                status === 'GROUNDED'
              ) {
                status = 'PARTIALLY_GROUNDED';
              }
            }
          } else {
            // Baseline P4: map thô usedContext → chunk, không tách claim.
            citations = this.baselineCitations(context.chunks, gen.citedIndexes);
          }
        }
      }

      const latencyMs = Date.now() - t0;
      trace.totalLatencyMs = latencyMs;
      const cleanTrace = sanitizeTrace(trace);

      await this.prisma.ragQuery.update({
        where: { id: ragQuery.id },
        data: {
          status: toDbStatus(status),
          answer,
          provider,
          model,
          usage,
          faithfulness: faithfulnessResult?.score ?? null,
          trace: cleanTrace as Prisma.InputJsonValue,
          claims: claims as unknown as Prisma.InputJsonValue,
          latencyMs,
        },
      });
      await this.persistCitations(ragQuery.id, citations, context.chunks);

      return {
        id: ragQuery.id,
        query: req.query,
        status,
        answer,
        citations,
        claims,
        faithfulness: faithfulnessResult,
        retrieval: {
          strategy: retrieval.strategy,
          // Chunk THỰC SỰ vào prompt generation (sau rerank + token budget của
          // ContextBuilder), KHÔNG phải danh sách retrieval thô.
          chunkCount: context.chunks.length,
          topScore: validation.topScore,
          chunks: context.chunks.map((c) => ({
            chunkId: c.chunkId,
            documentId: c.documentId,
            score: c.score,
            source: c.source,
            heading: c.heading,
            section: c.section,
            page: c.page,
          })),
        },
        provider,
        model,
        usage,
        latencyMs,
        trace: cleanTrace,
      };
    } catch (err) {
      const reason =
        err instanceof AppError
          ? `${err.code}: ${err.message}`
          : ((err as Error)?.message ?? 'unknown');
      this.logger.error(`RAG query ${ragQuery.id} lỗi: ${reason}`);
      const cleanErrorTrace = sanitizeTrace(trace);
      await this.prisma.ragQuery.update({
        where: { id: ragQuery.id },
        data: {
          error: reason,
          trace: cleanErrorTrace as Prisma.InputJsonValue,
          latencyMs: Date.now() - t0,
        },
      });

      // Biên API: ném lại để trả HTTP đúng (AppError.httpStatus). Đã ghi
      // RagQuery.error ở trên nên vẫn audit được.
      if (opts.rethrow) throw err;

      return {
        id: ragQuery.id,
        query: req.query,
        status: 'ERROR',
        answer: null,
        citations: [],
        claims: [],
        faithfulness: null,
        retrieval: {
          strategy: req.strategy ?? 'vector',
          chunkCount: 0,
          topScore: null,
          chunks: [],
        },
        provider: null,
        model: null,
        usage,
        latencyMs: Date.now() - t0,
        error: reason,
        trace: cleanErrorTrace,
      };
    }
  }

  /**
   * PHASE 9: answer → claim (LLM) → evidence (so khớp từ vựng, thuần) → citation
   * do backend quản lý (§29). Không map được claim → citation `valid: false`.
   */
  private async runCitation(
    answer: string,
    citedIndexes: number[],
    chunks: RetrievedChunk[],
  ): Promise<{
    citations: Citation[];
    claims: VerifiedClaim[];
    rawClaims: Claim[];
    rawEvidence: Evidence[];
    usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
    trace: Record<string, unknown>;
  }> {
    const extraction = await this.claimExtractor.extract(answer);
    const usedChunkIds = citedIndexes
      .map((i) => chunks[i - 1]?.chunkId)
      .filter((id): id is string => !!id);

    const evidence = this.evidenceMatcher.match(extraction.claims, chunks, {
      usedContextChunkIds: usedChunkIds,
    });
    const evByClaim = new Map(evidence.map((e) => [e.claimId, e]));

    const built = await this.citation.build(extraction.claims, evidence, chunks);

    const claims: VerifiedClaim[] = extraction.claims.map((c) => {
      const e = evByClaim.get(c.id);
      return {
        id: c.id,
        text: c.text,
        supported: e?.supported ?? false,
        verdict: e?.verdict ?? 'UNSUPPORTED',
        evidenceChunkIds: e?.evidenceChunkIds ?? [],
      };
    });

    return {
      citations: built.citations,
      claims,
      rawClaims: extraction.claims,
      rawEvidence: evidence,
      usage: {
        inputTokens: extraction.usage.inputTokens,
        outputTokens: extraction.usage.outputTokens,
        estimatedCost: extraction.usage.estimatedCost,
      },
      trace: {
        claimCount: claims.length,
        supportedClaims: claims.filter((c) => c.supported).length,
        extractionMethod: extraction.method,
        ...built.stats,
      },
    };
  }

  /**
   * Citation baseline (PHASE 4): map trực tiếp chỉ số context LLM nói đã dùng →
   * chunk → document. Không tách claim. `valid` = LLM có nêu và chỉ số hợp lệ.
   */
  private baselineCitations(
    chunks: RetrievedChunk[],
    citedIndexes: number[],
  ): Citation[] {
    return citedIndexes
      .map((i) => chunks[i - 1])
      .filter((c): c is RetrievedChunk => !!c)
      .map((c) => ({
        claimId: '',
        claimText: '',
        kind: 'chunk' as const,
        documentId: c.documentId,
        chunkId: c.chunkId,
        page: c.page,
        section: c.section,
        valid: true,
      }));
  }

  /**
   * Lưu `Citation` (audit §29). FK `documentId`/`chunkId` chỉ ghi khi trỏ tới
   * chunk có trong ngữ cảnh (đảm bảo tồn tại trong Postgres) — citation quan hệ
   * lấy chunkId từ Neo4j có thể không khớp, khi đó để null nhưng vẫn giữ
   * sourceEntity/targetEntity.
   */
  private async persistCitations(
    ragQueryId: string,
    citations: Citation[],
    contextChunks: RetrievedChunk[],
  ): Promise<void> {
    if (citations.length === 0) return;
    const validChunkIds = new Set(contextChunks.map((c) => c.chunkId));
    const validDocIds = new Set(contextChunks.map((c) => c.documentId));

    await this.prisma.citation.createMany({
      data: citations.map((c) => ({
        ragQueryId,
        claimId: c.claimId,
        claimText: c.claimText,
        kind: c.kind,
        documentId: validDocIds.has(c.documentId) ? c.documentId : null,
        chunkId: validChunkIds.has(c.chunkId) ? c.chunkId : null,
        page: c.page ?? null,
        section: c.section ?? null,
        sourceEntity: c.sourceEntity ?? null,
        targetEntity: c.targetEntity ?? null,
        relationType: c.relationType ?? null,
        valid: c.valid,
      })),
    });
  }
}

function toDbStatus(status: RagStatus | 'ERROR'): RagStatusEnum | null {
  if (status === 'ERROR') return null;
  return RagStatusEnum[status];
}
