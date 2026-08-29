import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import type {
  RetrievalFilters,
  RetrievalSource,
  RetrievedChunk,
} from '../../common/types';
import { VectorRetrieverService } from './vector-retriever.service';
import { KeywordRetrieverService } from './keyword-retriever.service';
import { GraphRetrieverService } from './graph-retriever.service';
import { fuse, type RetrieverOutput } from './fusion';
import type { Retriever, RetrieverResult } from './retriever.interface';

export type RetrievalStrategy = 'vector' | 'keyword' | 'graph' | 'hybrid';

export interface RetrievalRequest {
  query: string;
  topK?: number;
  filters?: RetrievalFilters;
  /** Ghi đè chiến lược mặc định (`RETRIEVAL_STRATEGY`). */
  strategy?: RetrievalStrategy;
  /** ID của RagQuery để nối RetrievalLog (nếu gọi trong pipeline). */
  ragQueryId?: string;
  /** Ghi RetrievalLog hay không (mặc định có). */
  log?: boolean;
}

export interface RetrievalResponse {
  query: string;
  strategy: RetrievalStrategy;
  chunks: RetrievedChunk[];
  latencyMs: number;
  usage: { embeddingTokens: number; estimatedCost: number };
  trace: Record<string, unknown>;
  /**
   * Lỗi HẠ TẦNG khiến truy hồi không chạy được (embed query lỗi, Neo4j chết…)
   * — KHÁC với "chạy xong nhưng không có kết quả". Chỉ set khi MỌI retriever
   * được chọn đều fail vì hạ tầng. Caller KHÔNG được che thành
   * `INSUFFICIENT_EVIDENCE` (PROMPT §54).
   */
  error?: string;
}

const STRATEGY_SOURCES: Record<RetrievalStrategy, RetrievalSource[]> = {
  vector: ['vector'],
  keyword: ['keyword'],
  graph: ['graph'],
  hybrid: ['vector', 'keyword', 'graph'],
};

/**
 * Điều phối truy hồi (PROMPT §16-18):
 *
 *   strategy (req | RETRIEVAL_STRATEGY) → chạy song song các retriever →
 *   fusion (RRF | weighted) → RetrievedChunk[] → RetrievalLog.
 *
 * Mỗi retriever tuân hợp đồng `Retriever` (không ném khi "không tìm thấy"; lỗi
 * hạ tầng → `trace.error`). RetrievalService gom lại: chỉ báo `error` toàn cục
 * khi MỌI nguồn được chọn đều fail hạ tầng — còn 1 nguồn sống thì fusion tiếp.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly defaultTopK: number;
  private readonly defaultStrategy: RetrievalStrategy;
  private readonly fusionCfg: AppConfig['retrieval']['fusion'];
  private readonly registry: Record<RetrievalSource, Retriever | null>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vector: VectorRetrieverService,
    private readonly keyword: KeywordRetrieverService,
    private readonly graph: GraphRetrieverService,
    config: ConfigService<AppConfig, true>,
  ) {
    const rag = config.get('rag', { infer: true });
    const retrieval = config.get('retrieval', { infer: true });
    this.defaultTopK = rag.retrievalTopK;
    this.defaultStrategy = retrieval.strategy;
    this.fusionCfg = retrieval.fusion;
    this.registry = {
      vector: this.vector,
      keyword: this.keyword,
      graph: this.graph,
      hybrid: null,
    };
  }

  async retrieve(req: RetrievalRequest): Promise<RetrievalResponse> {
    const topK = req.topK ?? this.defaultTopK;
    const strategy = req.strategy ?? this.defaultStrategy;
    const started = Date.now();

    const sources = STRATEGY_SOURCES[strategy];
    const results = await Promise.all(
      sources.map(async (source) => {
        const retriever = this.registry[source]!;
        try {
          const res = await retriever.retrieve({
            query: req.query,
            topK,
            filters: req.filters,
          });
          return { source, res };
        } catch (err) {
          // Retriever KHÔNG được ném (hợp đồng) — nếu vẫn ném, cô lập lỗi để
          // các nguồn khác trong hybrid vẫn chạy (§54).
          this.logger.warn(
            `Retriever "${source}" ném lỗi (vi phạm hợp đồng): ${(err as Error).message}`,
          );
          return {
            source,
            res: {
              chunks: [],
              latencyMs: 0,
              embeddingTokens: 0,
              estimatedCost: 0,
              trace: { error: `${source}_threw` },
            },
          };
        }
      }),
    );

    let embeddingTokens = 0;
    let estimatedCost = 0;
    const perSourceTrace: Record<string, unknown> = {};
    const outputs: RetrieverOutput[] = [];
    let infraFailures = 0;

    for (const { source, res } of results) {
      embeddingTokens += res.embeddingTokens;
      estimatedCost += res.estimatedCost;
      // Gắn latency từng nguồn vào trace (PHASE 16 — quan sát được nơi tốn thời
      // gian: retrieval vs generation vs faithfulness).
      perSourceTrace[source] = { ...res.trace, latencyMs: res.latencyMs };
      if (typeof res.trace.error === 'string') infraFailures++;
      outputs.push({ source, chunks: res.chunks });
    }

    const chunks =
      sources.length === 1
        ? this.singleSourceChunks(outputs, topK)
        : fuse(outputs, this.fusionCfg, topK);

    const response: RetrievalResponse = {
      query: req.query,
      strategy,
      chunks,
      latencyMs: Date.now() - started,
      usage: { embeddingTokens, estimatedCost },
      trace: {
        latencyMs: Date.now() - started,
        ...perSourceTrace,
        fusion:
          sources.length > 1
            ? { method: this.fusionCfg.method, sources }
            : undefined,
      },
      // Lỗi toàn cục CHỈ khi mọi nguồn được chọn đều fail hạ tầng.
      error:
        infraFailures === sources.length
          ? firstError(results.map((r) => r.res))
          : undefined,
    };

    if (req.log !== false) {
      await this.writeLog(req, topK, strategy, response).catch((err) => {
        this.logger.warn(`Ghi RetrievalLog lỗi: ${(err as Error).message}`);
      });
    }
    return response;
  }

  private singleSourceChunks(
    outputs: RetrieverOutput[],
    topK: number,
  ): RetrievedChunk[] {
    return [...(outputs[0]?.chunks ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async writeLog(
    req: RetrievalRequest,
    topK: number,
    strategy: string,
    response: RetrievalResponse,
  ): Promise<void> {
    await this.prisma.retrievalLog.create({
      data: {
        ragQueryId: req.ragQueryId ?? null,
        query: req.query,
        strategy,
        topK,
        filters: (req.filters ?? {}) as Prisma.InputJsonValue,
        results: response.chunks.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          score: c.score,
          source: c.source,
        })),
        latencyMs: response.latencyMs,
      },
    });
  }
}

function firstError(results: RetrieverResult[]): string {
  for (const r of results) {
    if (typeof r.trace.error === 'string') return r.trace.error;
  }
  return 'retrieval_failed';
}
