import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DocumentStatus } from '../../generated/prisma/client';

export type DuplicateType = 'EXACT' | 'NEAR';

export interface DedupResult {
  isDuplicate: boolean;
  type: DuplicateType | null;
  /** Document mà bản đang xét trùng lặp với. */
  duplicateOfId: string | null;
  /** Số document mồ côi (in-progress quá hạn) đã được thu hồi về FAILED. */
  reclaimed: number;
}

/** Document in-progress cũ hơn mốc này được coi là mồ côi và không khoá dedup. */
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Phát hiện trùng lặp ở mức document (PROMPT §11).
 *
 * - **EXACT**: cùng `checksum` (SHA-256 của bytes gốc).
 * - **NEAR**: cùng `normalizedHash` (hash của text đã chuẩn hoá) — bytes khác
 *   nhau nhưng nội dung sau chuẩn hoá giống hệt.
 *
 * Chỉ những document `COMPLETED`, hoặc đang xử lý mà CÒN MỚI (updatedAt trong
 * vòng {@link DEFAULT_STALE_AFTER_MS}), mới khoá được bản mới.
 *
 * Sửa deadlock (docs/audit/DATA_QUALITY_REVIEW.md [P0]): trước đây một document
 * kẹt vĩnh viễn ở `EMBEDDING` (vì embedding provider lỗi tạm thời) khiến MỌI
 * lần upload/seed lại cùng nội dung bị REJECT như trùng lặp chính xác — corpus
 * bị tê liệt. Nay document mồ côi được thu hồi về `FAILED` và không chặn bản mới.
 */
@Injectable()
export class DocumentDeduplicatorService {
  private readonly logger = new Logger(DocumentDeduplicatorService.name);
  private readonly staleAfterMs: number;

  constructor(private readonly prisma: PrismaService) {
    const raw = Number(process.env.INGESTION_STALE_AFTER_MS);
    this.staleAfterMs =
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_AFTER_MS;
  }

  async check(params: {
    checksum: string;
    normalizedHash: string | null;
    excludeId: string;
  }): Promise<DedupResult> {
    let reclaimed = 0;

    const exact = await this.resolveMatch(
      { checksum: params.checksum },
      params.excludeId,
    );
    reclaimed += exact.reclaimed;
    if (exact.blockingId) {
      return {
        isDuplicate: true,
        type: 'EXACT',
        duplicateOfId: exact.blockingId,
        reclaimed,
      };
    }

    if (params.normalizedHash) {
      const near = await this.resolveMatch(
        { normalizedHash: params.normalizedHash },
        params.excludeId,
      );
      reclaimed += near.reclaimed;
      if (near.blockingId) {
        return {
          isDuplicate: true,
          type: 'NEAR',
          duplicateOfId: near.blockingId,
          reclaimed,
        };
      }
    }

    return { isDuplicate: false, type: null, duplicateOfId: null, reclaimed };
  }

  /**
   * Với một điều kiện khớp (checksum hoặc normalizedHash), trả về id document
   * THỰC SỰ khoá được bản mới (nếu có) và thu hồi các bản mồ côi gặp phải.
   */
  private async resolveMatch(
    match: { checksum: string } | { normalizedHash: string },
    excludeId: string,
  ): Promise<{ blockingId: string | null; reclaimed: number }> {
    const candidates = await this.prisma.document.findMany({
      where: {
        ...match,
        id: { not: excludeId },
        status: { notIn: [DocumentStatus.REJECTED, DocumentStatus.FAILED] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, updatedAt: true },
    });

    const staleThreshold = Date.now() - this.staleAfterMs;
    const staleOrphans: string[] = [];

    for (const doc of candidates) {
      if (doc.status === DocumentStatus.COMPLETED) {
        return { blockingId: doc.id, reclaimed: 0 };
      }
      // đang xử lý: chỉ khoá nếu còn mới
      if (doc.updatedAt.getTime() >= staleThreshold) {
        return { blockingId: doc.id, reclaimed: 0 };
      }
      staleOrphans.push(doc.id);
    }

    if (staleOrphans.length > 0) {
      await this.prisma.document.updateMany({
        where: { id: { in: staleOrphans } },
        data: {
          status: DocumentStatus.FAILED,
          rejectedReason:
            'Ingestion mồ côi (kẹt quá hạn ở trạng thái đang xử lý) — thu hồi để cho phép nạp lại',
        },
      });
      this.logger.warn(
        `Thu hồi ${staleOrphans.length} document mồ côi: ${staleOrphans.join(', ')}`,
      );
    }

    return { blockingId: null, reclaimed: staleOrphans.length };
  }
}
