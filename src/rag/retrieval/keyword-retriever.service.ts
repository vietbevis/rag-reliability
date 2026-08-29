import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RetrievedChunk } from '../../common/types';
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
  rank: number;
}

/**
 * Truy hồi theo từ khoá dùng PostgreSQL Full-Text Search (PROMPT §17).
 *
 * Sử dụng cấu hình từ điển 'simple' và hàm `websearch_to_tsquery` để hỗ trợ
 * tìm kiếm chính xác các mã văn bản, số quyết định, tên riêng, thuật ngữ kỹ thuật.
 *
 * Điểm `ts_rank` không có trần trên cố định, được chuẩn hoá về [0,1] thông qua
 * hàm phi tuyến đơn điệu: `rank / (rank + 1)`. Hàm này đảm bảo rank cao hơn
 * luôn có score cao hơn, rank = 0 tương ứng score = 0, và score luôn thuộc [0, 1].
 */
@Injectable()
export class KeywordRetrieverService implements Retriever {
  readonly source = 'keyword' as const;
  private readonly logger = new Logger(KeywordRetrieverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async retrieve(options: RetrieveOptions): Promise<RetrieverResult> {
    const started = Date.now();

    // Nếu query rỗng hoặc chỉ chứa ký tự đặc biệt không tạo ra tsquery hợp lệ
    if (!options.query || !/[\p{L}\p{N}]/u.test(options.query)) {
      return emptyResult({ reason: 'empty_tsquery' });
    }

    const where = this.buildWhere(options);

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT c."id", c."documentId", c."content", c."heading", c."section",
             c."page", c."metadata",
             ts_rank(to_tsvector('simple', c."content"),
                     websearch_to_tsquery('simple', ${options.query})) AS rank
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${where}
      ORDER BY rank DESC
      LIMIT ${options.topK}
    `;

    const chunks: RetrievedChunk[] = rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: this.toScore(Number(r.rank)),
      source: 'keyword',
      heading: r.heading ?? undefined,
      section: r.section ?? undefined,
      page: r.page ?? undefined,
      metadata: {
        ...(r.metadata as Record<string, unknown>),
        rank: Number(r.rank),
      },
    }));

    return {
      chunks,
      latencyMs: Date.now() - started,
      embeddingTokens: 0,
      estimatedCost: 0,
      trace: {
        candidates: chunks.length,
        topScore: chunks[0]?.score ?? null,
      },
    };
  }

  private buildWhere(options: RetrieveOptions): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', ${options.query})`,
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

  /**
   * Chuẩn hoá ts_rank (không có trần trên) về khoảng [0,1].
   * Công thức: rank / (rank + 1).
   */
  private toScore(rank: number): number {
    const normalized = rank > 0 ? rank / (rank + 1) : 0;
    return Math.max(0, Math.min(1, Number(normalized.toFixed(6))));
  }
}
