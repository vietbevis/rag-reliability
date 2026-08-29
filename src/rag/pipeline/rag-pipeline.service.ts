import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppError, EmbeddingError } from '../../common/errors';
import type {
  Citation,
  RagStatus,
  RetrievalFilters,
  RetrievedChunk,
} from '../../common/types';
import {
  Prisma,
  RagStatus as RagStatusEnum,
} from '../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { RerankerService } from '../../ai/reranking/reranker.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ContextBuilderService } from '../context/context-builder.service';
import { ContextValidatorService } from '../context/context-validator.service';
import { AnswerGenerationService } from '../grounding/answer-generation.service';

export interface RagQueryRequest {
  query: string;
  topK?: number;
  filters?: RetrievalFilters;
  strategy?: 'vector' | 'keyword' | 'graph' | 'hybrid';
  /** Ghi đè `RERANK_ENABLED` cho request này (benchmark before/after). */
  rerank?: boolean;
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
  claims: [];
  faithfulness: null;
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
 * Pipeline truy vấn RAG (PROMPT §41). PHASE 4:
 *
 *   query → retrieve (vector) → context build → context validation
 *         → (đủ) generate | (không đủ) abstain
 *         → persist RagQuery + trace
 *
 * Claim extraction / evidence matching / faithfulness / citation cấp claim đến
 * ở PHASE 8-9 (hiện `citations`/`claims` rỗng, `faithfulness` null). Reranking
 * ở PHASE 7.
 */
@Injectable()
export class RagPipelineService {
  private readonly logger = new Logger(RagPipelineService.name);
  private readonly rerankCfg: AppConfig['rerank'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly reranker: RerankerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly contextValidator: ContextValidatorService,
    private readonly generation: AnswerGenerationService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.rerankCfg = config.get('rerank', { infer: true });
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

      const validation = this.contextValidator.validate(context);
      trace.validation = validation;

      let status: RagStatus | 'ERROR';
      let answer: string | null;
      let provider: string | null = null;
      let model: string | null = null;
      let citations: Citation[] = [];

      if (!validation.proceed) {
        status = 'INSUFFICIENT_EVIDENCE';
        answer = ABSTAIN_ANSWER;
      } else {
        const gen = await this.generation.generate(req.query, context);
        status = gen.status;
        answer = gen.answer;
        provider = gen.provider;
        model = gen.model;
        usage.inputTokens += gen.usage.inputTokens;
        usage.outputTokens += gen.usage.outputTokens;
        usage.estimatedCost += gen.usage.estimatedCost;
        trace.generation = {
          latencyMs: gen.latencyMs,
          citedIndexes: gen.citedIndexes,
        };
        citations = this.baselineCitations(context.chunks, gen.citedIndexes);
      }

      const latencyMs = Date.now() - t0;
      await this.prisma.ragQuery.update({
        where: { id: ragQuery.id },
        data: {
          status: toDbStatus(status),
          answer,
          provider,
          model,
          usage,
          trace: trace as Prisma.InputJsonValue,
          latencyMs,
        },
      });

      return {
        id: ragQuery.id,
        query: req.query,
        status,
        answer,
        citations,
        claims: [],
        faithfulness: null,
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
        trace,
      };
    } catch (err) {
      const reason =
        err instanceof AppError
          ? `${err.code}: ${err.message}`
          : ((err as Error)?.message ?? 'unknown');
      this.logger.error(`RAG query ${ragQuery.id} lỗi: ${reason}`);
      await this.prisma.ragQuery.update({
        where: { id: ragQuery.id },
        data: {
          error: reason,
          trace: trace as Prisma.InputJsonValue,
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
        trace,
      };
    }
  }

  /**
   * Citation baseline (PHASE 4): map trực tiếp chỉ số context LLM nói đã dùng →
   * chunk → document. Chưa xác minh claim (PHASE 8-9). `valid` = LLM có nêu và
   * chỉ số hợp lệ; không suy diễn thêm.
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
        documentId: c.documentId,
        chunkId: c.chunkId,
        page: c.page,
        section: c.section,
        valid: true,
      }));
  }
}

function toDbStatus(status: RagStatus | 'ERROR'): RagStatusEnum | null {
  if (status === 'ERROR') return null;
  return RagStatusEnum[status];
}
