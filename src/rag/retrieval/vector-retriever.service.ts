import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { AppError } from '../../common/errors';
import type { RetrievedChunk } from '../../common/types';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import { VectorSchemaService } from '../embedding/vector-schema.service';
import {
  emptyResult,
  type Retriever,
  type RetrieveOptions,
  type RetrieverResult,
} from './retriever.interface';

interface Row {
  id: string;
  documentId: string;
  content: string;
  heading: string | null;
  section: string | null;
  page: number | null;
  metadata: unknown;
  distance: number;
}

/**
 * Truy hồi bằng vector similarity trên pgvector (PROMPT §16). Embed câu hỏi
 * bằng cùng model đã dùng lúc ingest, tính khoảng cách theo `EMBEDDING_DISTANCE`
 * (index HNSW), lọc chỉ tài liệu `COMPLETED`.
 *
 * `score` chuẩn hoá về [0,1] theo từng loại khoảng cách:
 * - cosine (`<=>`, distance ∈ [0,2]): `1 - distance/2`
 * - ip (`<#>`, negative inner product ∈ [-1,1] với vector đã normalize):
 *   `(1 - distance) / 2` (distance = -similarity → similarity cao ⇒ score cao)
 * - l2 (`<->`, distance ≥ 0): `1 / (1 + distance)`
 */
@Injectable()
export class VectorRetrieverService implements Retriever {
  readonly source = 'vector' as const;
  private readonly logger = new Logger(VectorRetrieverService.name);
  private readonly distanceOp: string;
  private readonly distanceKind: AppConfig['embedding']['distance'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly vectorSchema: VectorSchemaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.distanceKind = config.get('embedding', { infer: true }).distance;
    this.distanceOp = this.vectorSchema.distanceOperator;
  }

  async retrieve(options: RetrieveOptions): Promise<RetrieverResult> {
    const started = Date.now();
    if (!this.embeddings.isConfigured()) {
      return emptyResult({ skipped: 'embedding provider chưa cấu hình' });
    }

    let queryVector: number[];
    let embeddingTokens = 0;
    let estimatedCost = 0;
    try {
      const res = await this.embeddings.embed(options.query);
      queryVector = res.vector;
      embeddingTokens = res.usage.totalTokens;
      estimatedCost = res.usage.estimatedCost;
    } catch (err) {
      this.logger.warn(
        `Embed query lỗi: ${err instanceof AppError ? err.code : (err as Error).message}`,
      );
      return emptyResult({ error: 'embed_query_failed' });
    }

    const model = this.embeddings.activeModel;
    const vecLiteral = `[${queryVector.join(',')}]`;
    const where = this.buildWhere(options, model);
    const distanceOp = Prisma.raw(this.distanceOp);

    let rows: Row[];
    try {
      rows = await this.prisma.$queryRaw<Row[]>`
        SELECT c."id", c."documentId", c."content", c."heading", c."section",
               c."page", c."metadata",
               e."embedding" ${distanceOp} ${vecLiteral}::vector AS distance
        FROM "Embedding" e
        JOIN "DocumentChunk" c ON c."id" = e."chunkId"
        JOIN "Document" d ON d."id" = c."documentId"
        WHERE ${where}
        ORDER BY distance ASC
        LIMIT ${options.topK}
      `;
    } catch (err) {
      // Hợp đồng Retriever: KHÔNG ném (§54) — để fusion tiếp với nguồn khác.
      this.logger.warn(`Vector query lỗi: ${(err as Error).message}`);
      return emptyResult({ error: 'vector_db_failed' });
    }

    const chunks: RetrievedChunk[] = rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: this.toScore(Number(r.distance)),
      source: 'vector',
      heading: r.heading ?? undefined,
      section: r.section ?? undefined,
      page: r.page ?? undefined,
      metadata: {
        ...(r.metadata as Record<string, unknown>),
        distance: Number(r.distance),
      },
    }));

    return {
      chunks,
      latencyMs: Date.now() - started,
      embeddingTokens,
      estimatedCost,
      trace: {
        model,
        distance: this.distanceKind,
        candidates: chunks.length,
        topScore: chunks[0]?.score ?? null,
      },
    };
  }

  private buildWhere(options: RetrieveOptions, model: string): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`e."model" = ${model}`,
      Prisma.sql`d."status" = 'COMPLETED'::"DocumentStatus"`,
    ];
    const f = options.filters;
    if (f?.documentIds?.length) {
      parts.push(Prisma.sql`c."documentId" IN (${Prisma.join(f.documentIds)})`);
    }
    if (f?.sources?.length) {
      parts.push(Prisma.sql`d."source" IN (${Prisma.join(f.sources)})`);
    }
    for (const [key, value] of Object.entries(f?.metadata ?? {})) {
      parts.push(Prisma.sql`c."metadata" ->> ${key} = ${String(value)}`);
    }
    return Prisma.join(parts, ' AND ');
  }

  private toScore(distance: number): number {
    let s: number;
    switch (this.distanceKind) {
      case 'cosine':
        s = 1 - distance / 2;
        break;
      case 'ip':
        // `<#>` = -inner_product; vector đã normalize ⇒ distance ∈ [-1, 1].
        s = (1 - distance) / 2;
        break;
      default: // 'l2'
        s = 1 / (1 + Math.max(distance, 0));
    }
    return Math.max(0, Math.min(1, Number(s.toFixed(6))));
  }
}
