import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IngestionError } from '../../common/errors';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import { EmbeddingProviderName } from '../../ai/llm/llm-provider.enum';
import {
  DocumentStatus,
  IngestionStage,
  JobStatus,
  Prisma,
} from '../../generated/prisma/client';
import { VectorSchemaService } from './vector-schema.service';

const EMBEDDABLE_STATUSES: DocumentStatus[] = [
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.COMPLETED,
];

/** ~50k ký tự param mỗi INSERT — chia lô theo số chiều để không quá lớn. */
const insertBatchFor = (dim: number): number =>
  Math.max(1, Math.floor(50_000 / Math.max(dim, 1)));

export interface EmbeddingRunResult {
  documentId: string;
  /** true = bỏ qua (provider chưa cấu hình). */
  skipped: boolean;
  reason?: string;
  /** Có giá trị khi đã thử embedding nhưng thất bại (document + chunk vẫn hợp lệ). */
  error?: string;
  provider?: string;
  model?: string;
  dimensions?: number;
  embeddedChunks?: number;
  usage?: { inputTokens: number; estimatedCost: number };
  ms?: number;
}

/**
 * Sinh embedding cho toàn bộ chunk của một document rồi lưu vào pgvector
 * (PROMPT §14, §15). Batch qua {@link EmbeddingService} (đã chia lô theo
 * `EMBEDDING_BATCH_SIZE`), ghi cột `vector` bằng raw SQL. Sau khi xong,
 * document chuyển `CHUNKING → COMPLETED`.
 *
 * Nếu provider embedding chưa cấu hình (thiếu API key) → BỎ QUA êm, không làm
 * hỏng document; có thể chạy lại sau qua `POST /documents/:id/embed`.
 */
@Injectable()
export class ChunkEmbeddingService {
  private readonly logger = new Logger(ChunkEmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly vectorSchema: VectorSchemaService,
  ) {}

  async embedDocument(
    documentId: string,
    providerOverride?: EmbeddingProviderName,
  ): Promise<EmbeddingRunResult> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc)
      throw new NotFoundException(`Document ${documentId} không tồn tại`);
    if (!EMBEDDABLE_STATUSES.includes(doc.status)) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        `Document ở trạng thái ${doc.status}, phải chunk xong (CHUNKING) trước khi embedding`,
      );
    }

    if (!this.embeddings.isConfigured(providerOverride)) {
      const reason = `Provider embedding "${providerOverride ?? this.embeddings.activeProvider}" chưa cấu hình (thiếu API key/URL)`;
      this.logger.warn(`Bỏ qua embedding ${documentId}: ${reason}`);
      return { documentId, skipped: true, reason };
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { sequence: 'asc' },
      select: { id: true, content: true },
    });
    if (chunks.length === 0) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        'Document chưa có chunk nào',
      );
    }

    // Kiểm tra số chiều: provider vs cột DB.
    const columnDim = await this.vectorSchema.getColumnDimension();
    const providerDim = this.embeddings.dimensions;
    if (columnDim !== null && columnDim !== providerDim) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        `Số chiều embedding của provider (${providerDim}) khác cột DB vector(${columnDim}). ` +
          `Chạy migration đổi cột hoặc chỉnh EMBEDDING_DIMENSION.`,
      );
    }

    const t0 = Date.now();
    await this.setStatus(documentId, DocumentStatus.EMBEDDING);

    const batch = await this.embeddings.embedBatch(
      chunks.map((c) => c.content),
      providerOverride,
    );
    if (batch.vectors.length !== chunks.length) {
      throw new IngestionError(
        'INGESTION_FAILED',
        `Provider trả ${batch.vectors.length} vector cho ${chunks.length} chunk`,
      );
    }
    if (batch.vectors.some((v) => v.some((x) => !Number.isFinite(x)))) {
      throw new IngestionError(
        'INGESTION_FAILED',
        'Provider trả về giá trị vector không hợp lệ (NaN/Infinity)',
      );
    }

    const provider = String(providerOverride ?? this.embeddings.activeProvider);
    const model = batch.model;
    const chunkIds = chunks.map((c) => c.id);
    const insertBatch = insertBatchFor(providerDim);

    await this.prisma.$transaction(async (tx) => {
      // Khoá theo document để hai lần re-embed song song không đụng
      // @@unique([chunkId, model]) (delete của bên này chưa thấy insert của bên kia).
      // $executeRaw (không $queryRaw) vì hàm trả về `void`.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${documentId}))`;

      await tx.embedding.deleteMany({
        where: { chunkId: { in: chunkIds }, model },
      });

      for (let i = 0; i < chunks.length; i += insertBatch) {
        const slice = chunks.slice(i, i + insertBatch);
        const values = slice.map((chunk, j) => {
          const vec = `[${batch.vectors[i + j]!.join(',')}]`;
          return Prisma.sql`(${randomUUID()}, ${chunk.id}, ${provider}, ${model}, ${providerDim}, ${vec}::vector, NOW())`;
        });
        await tx.$executeRaw`
          INSERT INTO "Embedding" ("id","chunkId","provider","model","dimensions","embedding","createdAt")
          VALUES ${Prisma.join(values)}
        `;
      }

      await tx.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.COMPLETED },
      });

      await tx.ingestionJob.create({
        data: {
          documentId,
          stage: IngestionStage.EMBED,
          status: JobStatus.COMPLETED,
          startedAt: new Date(t0),
          finishedAt: new Date(),
          metrics: {
            provider,
            model,
            dimensions: providerDim,
            chunkCount: chunks.length,
            inputTokens: batch.usage.inputTokens,
            estimatedCost: batch.usage.estimatedCost,
            ms: Date.now() - t0,
          },
        },
      });
    });

    const result: EmbeddingRunResult = {
      documentId,
      skipped: false,
      provider,
      model,
      dimensions: providerDim,
      embeddedChunks: chunks.length,
      usage: {
        inputTokens: batch.usage.inputTokens,
        estimatedCost: batch.usage.estimatedCost,
      },
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Embedded ${documentId}: ${result.embeddedChunks} chunk (${provider}/${model}, ${providerDim}d), ` +
        `${result.usage!.inputTokens} tok, $${result.usage!.estimatedCost}`,
    );
    return result;
  }

  private async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.prisma.document.update({ where: { id }, data: { status } });
  }
}
