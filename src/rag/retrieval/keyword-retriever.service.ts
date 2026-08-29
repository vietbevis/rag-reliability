import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RetrievedChunk } from '../../common/types';
import { toKeywordQuery } from '../../common/utils';
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
 * Câu hỏi tự nhiên được chuẩn hoá qua `toKeywordQuery` (bỏ từ nghi vấn, nối
 * bằng `or`) trước khi đưa vào tsquery — nếu không, một từ nghi vấn vắng mặt
 * trong văn bản ("mấy", "bao nhiêu") sẽ khiến phép AND trả về 0 kết quả.
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

    // Câu hỏi tự nhiên ("... tối đa mấy học kỳ?") → chuỗi từ khoá nối bằng `or`,
    // bỏ từ nghi vấn. Nếu sau khi lọc không còn token nghĩa (query toàn hư từ)
    // thì fallback về query gốc để `websearch_to_tsquery` tự xử lý.
    const tsInput = toKeywordQuery(options.query) || options.query;

    const where = this.buildWhere(options, tsInput);

    let rows: Row[];
    try {
      // Cột generated `contentTsv` (migration phase6_tsvector) — tránh tính
      // `to_tsvector` hai lần và dùng GIN index trực tiếp.
      rows = await this.prisma.$queryRaw<Row[]>`
        SELECT c."id", c."documentId", c."content", c."heading", c."section",
               c."page", c."metadata",
               ts_rank(c."contentTsv",
                       websearch_to_tsquery('simple', ${tsInput})) AS rank
        FROM "DocumentChunk" c
        JOIN "Document" d ON d."id" = c."documentId"
        WHERE ${where}
        ORDER BY rank DESC
        LIMIT ${options.topK}
      `;
    } catch (err) {
      // Hợp đồng Retriever: KHÔNG ném — trả rỗng + trace.error để fusion tiếp
      // với nguồn khác (PROMPT §54).
      this.logger.warn(`Keyword query lỗi: ${(err as Error).message}`);
      return emptyResult({ error: 'keyword_db_failed' });
    }

    // Chuẩn hoá score theo batch (ts_rank tuyệt đối rất nhỏ ~0.05 → nếu để
    // nguyên sẽ bị ContextValidator từ chối & chìm trong weighted fusion).
    const maxRank = Math.max(...rows.map((r) => Number(r.rank)), 1e-9);
    const chunks: RetrievedChunk[] = rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: this.toScore(Number(r.rank), maxRank),
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

  private buildWhere(options: RetrieveOptions, tsInput: string): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`c."contentTsv" @@ websearch_to_tsquery('simple', ${tsInput})`,
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
   * Chuẩn hoá ts_rank về [0,1] theo BATCH: `rank / maxRank`. Kết quả khớp tốt
   * nhất của lượt tìm ≈ 1.0 (nhất quán với cách vector/graph chuẩn hoá tương
   * đối), rank tuyệt đối rất nhỏ không còn làm score chìm.
   */
  private toScore(rank: number, maxRank: number): number {
    if (rank <= 0) return 0;
    return Math.max(0, Math.min(1, Number((rank / maxRank).toFixed(6))));
  }
}
