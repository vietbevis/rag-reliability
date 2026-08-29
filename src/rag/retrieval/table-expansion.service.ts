import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { RetrievalSource, RetrievedChunk } from '../../common/types';
import { PrismaService } from '../../database/prisma.service';

interface SiblingRow {
  id: string;
  documentId: string;
  content: string;
  heading: string | null;
  section: string | null;
  page: number | null;
  metadata: unknown;
}

export interface TableExpansionResult {
  chunks: RetrievedChunk[];
  trace: {
    enabled: boolean;
    groups?: number;
    added?: number;
    capped?: boolean;
  };
}

/**
 * Retrieval bảng (PROMPT §12, §16 — trần chất lượng của pipeline).
 *
 * Bảng GFM lớn bị chunker cắt thành nhiều mảnh mang chung `metadata.tableGroup`
 * (xem {@link StructureAwareChunkerService}). Vector/keyword retrieval thường chỉ
 * kéo về 1–2 mảnh khớp nhất → câu hỏi kiểu "liệt kê các mức / tỷ lệ / định mức"
 * bị trả lời thiếu và gắn nhãn `PARTIALLY_GROUNDED` một cách oan uổng.
 *
 * Service này chạy SAU rerank, TRƯỚC ContextBuilder: với mỗi mảnh bảng lọt vào
 * kết quả, kéo về tất cả các mảnh còn lại của cùng bảng (cùng `documentId` +
 * `tableGroup`) với điểm bám sát mảnh kích hoạt, để chúng nằm liền nhau khi
 * ContextBuilder sắp xếp và cùng lọt/không lọt ngân sách token.
 */
@Injectable()
export class TableExpansionService {
  private readonly logger = new Logger(TableExpansionService.name);
  private readonly enabled: boolean;
  private readonly maxChunks: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const cfg = config.get('rag', { infer: true });
    this.enabled = cfg.tableExpansion;
    this.maxChunks = cfg.tableExpansionMaxChunks;
  }

  async expand(chunks: RetrievedChunk[]): Promise<TableExpansionResult> {
    if (!this.enabled || this.maxChunks === 0 || chunks.length === 0) {
      return { chunks, trace: { enabled: this.enabled } };
    }

    // Gom nhóm bảng cần bổ sung: (documentId, tableGroup) → điểm + nguồn của
    // mảnh khớp nhất đã có.
    const present = new Set(chunks.map((c) => c.chunkId));
    const groups = new Map<
      string,
      {
        documentId: string;
        tableGroup: string;
        score: number;
        source: RetrievalSource;
      }
    >();
    for (const c of chunks) {
      const tableGroup = c.metadata?.tableGroup;
      if (typeof tableGroup !== 'string' || tableGroup.length === 0) continue;
      const key = `${c.documentId}::${tableGroup}`;
      const prev = groups.get(key);
      if (!prev || c.score > prev.score) {
        groups.set(key, {
          documentId: c.documentId,
          tableGroup,
          score: c.score,
          source: c.source,
        });
      }
    }
    if (groups.size === 0) {
      return { chunks, trace: { enabled: true, groups: 0, added: 0 } };
    }

    const added: RetrievedChunk[] = [];
    let capped = false;
    for (const g of groups.values()) {
      if (added.length >= this.maxChunks) {
        capped = true;
        break;
      }
      let rows: SiblingRow[];
      try {
        rows = await this.prisma.$queryRaw<SiblingRow[]>`
          SELECT c."id", c."documentId", c."content", c."heading", c."section",
                 c."page", c."metadata"
          FROM "DocumentChunk" c
          JOIN "Document" d ON d."id" = c."documentId"
          WHERE c."documentId" = ${g.documentId}
            AND c."metadata" ->> 'tableGroup' = ${g.tableGroup}
            AND d."status" = 'COMPLETED'::"DocumentStatus"
          ORDER BY c."sequence" ASC
        `;
      } catch (err) {
        // Không chặn pipeline vì lỗi bổ sung bảng — chỉ ghi log.
        this.logger.warn(
          `Table expansion query lỗi (bỏ qua): ${(err as Error).message}`,
        );
        continue;
      }

      for (const r of rows) {
        if (present.has(r.id)) continue;
        if (added.length >= this.maxChunks) {
          capped = true;
          break;
        }
        present.add(r.id);
        added.push({
          chunkId: r.id,
          documentId: r.documentId,
          content: r.content,
          // Ngay dưới mảnh kích hoạt: giữ cả bảng thành một cụm liền mạch khi
          // ContextBuilder sắp theo score.
          score: Math.max(0, g.score - 1e-4),
          source: g.source,
          heading: r.heading ?? undefined,
          section: r.section ?? undefined,
          page: r.page ?? undefined,
          metadata: {
            ...(r.metadata as Record<string, unknown>),
            tableExpanded: true,
          },
        });
      }
    }

    if (added.length === 0) {
      return {
        chunks,
        trace: { enabled: true, groups: groups.size, added: 0 },
      };
    }

    return {
      chunks: [...chunks, ...added],
      trace: {
        enabled: true,
        groups: groups.size,
        added: added.length,
        capped,
      },
    };
  }
}
