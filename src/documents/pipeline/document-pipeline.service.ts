import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import {
  IngestionService,
  type IngestionResult,
} from '../../rag/ingestion/ingestion.service';
import {
  ChunkingService,
  type ChunkingResult,
} from '../../rag/chunking/chunking.service';
import {
  ChunkEmbeddingService,
  type EmbeddingRunResult,
} from '../../rag/embedding/chunk-embedding.service';
import { GraphIngestionService } from '../../rag/graph/graph-ingestion.service';
import type { GraphIngestionResult } from '../../rag/graph/graph.types';
import { DocumentStatus } from '../../generated/prisma/client';
import type { PipelineTrigger } from './pipeline.constants';

/** Kết quả một lần chạy pipeline cho một tài liệu. */
export interface PipelineRunResult {
  documentId: string;
  status: DocumentStatus;
  ingestion: IngestionResult | null;
  chunking: ChunkingResult | null;
  embedding: EmbeddingRunResult | null;
  graph: GraphIngestionResult | null;
}

/**
 * Thân pipeline xử lý tài liệu — `ingest → chunk → embed → graph`. Tách khỏi
 * {@link DocumentsService} để cả nhánh đồng bộ (queue tắt) lẫn worker BullMQ
 * (queue bật) dùng chung một đường đi. Idempotent: chunking xoá-tạo lại chunk,
 * embedding upsert, graph có cache extraction — chạy lại an toàn.
 */
@Injectable()
export class DocumentPipelineService {
  private readonly logger = new Logger(DocumentPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly chunking: ChunkingService,
    private readonly embedding: ChunkEmbeddingService,
    private readonly graphIngestion: GraphIngestionService,
  ) {}

  /**
   * Chạy pipeline cho `documentId` (document phải đã tồn tại).
   * - `trigger='upload' | 'reingest'`: full pipeline. Lỗi ingest/chunk NÉM
   *   (chặn pipeline, job retry); lỗi embedding/graph KHÔNG ném.
   * - `trigger='graph'`: chỉ dựng lại graph, lỗi NÉM để job phản ánh rõ.
   */
  async run(
    documentId: string,
    trigger: PipelineTrigger,
  ): Promise<PipelineRunResult> {
    const t0 = Date.now();
    this.logger.log(`Pipeline ${documentId} bắt đầu (trigger=${trigger})`);
    const full = trigger !== 'graph';

    let ingestion: IngestionResult | null = null;
    let chunking: ChunkingResult | null = null;
    let embedding: EmbeddingRunResult | null = null;
    let graph: GraphIngestionResult | null = null;

    if (full) {
      ingestion = await this.ingestion.ingest(documentId);
      chunking =
        ingestion.status === DocumentStatus.VALIDATING
          ? await this.chunking.chunk(documentId)
          : null;
      embedding =
        chunking && chunking.chunkCount > 0
          ? await this.autoEmbed(documentId)
          : null;
      if (embeddingCompleted(embedding)) {
        graph = await this.runGraph(documentId, false);
      }
    } else {
      graph = await this.runGraph(documentId, true);
    }

    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { status: true },
    });
    this.logger.log(
      `Pipeline ${documentId} xong: status=${doc.status} (${Date.now() - t0}ms)`,
    );
    return {
      documentId,
      status: doc.status,
      ingestion,
      chunking,
      embedding,
      graph,
    };
  }

  /** Embedding trong pipeline tự động: lỗi provider KHÔNG làm hỏng pipeline. */
  private async autoEmbed(id: string): Promise<EmbeddingRunResult> {
    try {
      return await this.embedding.embedDocument(id);
    } catch (err) {
      const reason =
        err instanceof AppError
          ? `${err.code}: ${err.message}`
          : ((err as Error)?.message ?? 'unknown');
      this.logger.warn(
        `Auto-embed ${id} thất bại (document + chunk vẫn hợp lệ): ${reason}`,
      );
      return { documentId: id, skipped: false, error: reason };
    }
  }

  /**
   * Dựng graph. `throwOnError=false` (nhánh auto sau embed): lỗi Neo4j/extraction
   * chỉ log, document giữ ở GRAPHING. `throwOnError=true` (trigger='graph'): ném
   * để job BullMQ retry / đưa document về FAILED.
   */
  private async runGraph(
    id: string,
    throwOnError: boolean,
  ): Promise<GraphIngestionResult | null> {
    if (!this.graphIngestion.enabled) return null;
    return this.graphIngestion.ingest(id, { throwOnError });
  }
}

/** Embedding đã chạy xong (không bỏ qua, không lỗi) → sẵn sàng dựng graph. */
function embeddingCompleted(e: EmbeddingRunResult | null): boolean {
  return !!e && !e.skipped && !e.error;
}
