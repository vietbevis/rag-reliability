import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import type { RetrievalFilters, RetrievedChunk } from '../../common/types';
import { VectorRetrieverService } from './vector-retriever.service';

export interface RetrievalRequest {
  query: string;
  topK?: number;
  filters?: RetrievalFilters;
  /** ID của RagQuery để nối RetrievalLog (nếu gọi trong pipeline). */
  ragQueryId?: string;
  /** Ghi RetrievalLog hay không (mặc định có). */
  log?: boolean;
}

export interface RetrievalResponse {
  query: string;
  strategy: string;
  chunks: RetrievedChunk[];
  latencyMs: number;
  usage: { embeddingTokens: number; estimatedCost: number };
  trace: Record<string, unknown>;
}

/**
 * Điều phối truy hồi (PROMPT §16-18). PHASE 4 baseline = **chỉ vector**.
 * PHASE 6 thêm keyword + graph + fusion vào đây (cùng interface `Retriever`).
 * Mỗi lần truy hồi ghi một `RetrievalLog` để debug độc lập với generation.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly defaultTopK: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vector: VectorRetrieverService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.defaultTopK = config.get('rag', { infer: true }).retrievalTopK;
  }

  async retrieve(req: RetrievalRequest): Promise<RetrievalResponse> {
    const topK = req.topK ?? this.defaultTopK;
    const strategy = 'vector';
    const started = Date.now();

    const result = await this.vector.retrieve({
      query: req.query,
      topK,
      filters: req.filters,
    });

    const response: RetrievalResponse = {
      query: req.query,
      strategy,
      chunks: result.chunks,
      latencyMs: Date.now() - started,
      usage: {
        embeddingTokens: result.embeddingTokens,
        estimatedCost: result.estimatedCost,
      },
      trace: { vector: result.trace },
    };

    if (req.log !== false) {
      await this.writeLog(req, topK, strategy, response).catch((err) => {
        this.logger.warn(`Ghi RetrievalLog lỗi: ${(err as Error).message}`);
      });
    }
    return response;
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
