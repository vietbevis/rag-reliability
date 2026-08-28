import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DocumentStatus } from '../../generated/prisma/client';

export type DuplicateType = 'EXACT' | 'NEAR';

export interface DedupResult {
  isDuplicate: boolean;
  type: DuplicateType | null;
  /** Document mà bản đang xét trùng lặp với. */
  duplicateOfId: string | null;
}

/**
 * Phát hiện trùng lặp ở mức document (PROMPT §11).
 *
 * - **EXACT**: cùng `checksum` (SHA-256 của bytes gốc).
 * - **NEAR**: cùng `normalizedHash` (hash của text đã chuẩn hoá) — bytes khác
 *   nhau nhưng nội dung sau chuẩn hoá giống hệt.
 *
 * Chỉ so với các document đã xử lý xong và không bị REJECT/FAIL.
 * Chưa dùng ML cho near-duplicate ở phase này (PROMPT §11).
 */
@Injectable()
export class DocumentDeduplicatorService {
  constructor(private readonly prisma: PrismaService) {}

  async check(params: {
    checksum: string;
    normalizedHash: string | null;
    excludeId: string;
  }): Promise<DedupResult> {
    const notRejected = {
      status: { notIn: [DocumentStatus.REJECTED, DocumentStatus.FAILED] },
      id: { not: params.excludeId },
    };

    const exact = await this.prisma.document.findFirst({
      where: { ...notRejected, checksum: params.checksum },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (exact) {
      return { isDuplicate: true, type: 'EXACT', duplicateOfId: exact.id };
    }

    if (params.normalizedHash) {
      const near = await this.prisma.document.findFirst({
        where: { ...notRejected, normalizedHash: params.normalizedHash },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (near) {
        return { isDuplicate: true, type: 'NEAR', duplicateOfId: near.id };
      }
    }

    return { isDuplicate: false, type: null, duplicateOfId: null };
  }
}
