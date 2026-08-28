import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppError, IngestionError, ParserError } from '../../common/errors';
import { sha256 } from '../../common/utils';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { ParserFactoryService } from '../../documents/parsers/parser-factory.service';
import {
  DocumentStatus,
  IngestionStage,
  JobStatus,
  ParserType,
  type Prisma,
} from '../../generated/prisma/client';
import { DocumentCleanerService } from './document-cleaner.service';
import { DocumentDeduplicatorService } from './document-deduplicator.service';
import { DocumentNormalizerService } from './document-normalizer.service';
import { DocumentQualityService } from './document-quality.service';

const PARSER_TYPE_MAP: Record<string, ParserType> = {
  anydoc: ParserType.ANYDOC,
  plaintext: ParserType.PLAINTEXT,
  html: ParserType.HTML,
  fallback: ParserType.FALLBACK,
};

export interface IngestionResult {
  documentId: string;
  status: DocumentStatus;
  qualityScore: number | null;
  rejectedReason: string | null;
  duplicateOfId: string | null;
  stages: Array<{ stage: IngestionStage; status: JobStatus; ms: number }>;
}

/**
 * Điều phối pipeline ingestion (PROMPT §9, §54):
 *
 *   PARSING -> CLEANING (normalize + clean) -> VALIDATING (dedup + quality)
 *
 * PHASE 1 dừng ở đây; chunking/embedding thuộc PHASE 2-3. Mỗi stage ghi một
 * `IngestionJob` kèm thời gian. Lỗi được phân loại rõ ràng, không che giấu:
 * parser fail -> FAILED; quality/exact-duplicate -> REJECTED.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parsers: ParserFactoryService,
    private readonly normalizer: DocumentNormalizerService,
    private readonly cleaner: DocumentCleanerService,
    private readonly quality: DocumentQualityService,
    private readonly deduplicator: DocumentDeduplicatorService,
    private readonly tokens: TokenCounterService,
  ) {}

  async ingest(documentId: string): Promise<IngestionResult> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc)
      throw new NotFoundException(`Document ${documentId} không tồn tại`);
    if (!doc.rawContent) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        'Document không có bytes gốc để ingest (rawContent rỗng)',
      );
    }

    const bytes = new Uint8Array(doc.rawContent);
    const stages: IngestionResult['stages'] = [];
    const transformations: string[] = [];

    // dọn các job cũ khi re-ingest
    await this.prisma.ingestionJob.deleteMany({ where: { documentId } });

    try {
      // ---- PARSING --------------------------------------------------------
      await this.setStatus(documentId, DocumentStatus.PARSING);
      const parsed = await this.stage(
        documentId,
        IngestionStage.PARSE,
        stages,
        () =>
          this.parsers.parse({
            bytes,
            mimeType: doc.mimeType,
            filename:
              (doc.metadata as { originalName?: string } | null)
                ?.originalName ?? undefined,
          }),
      );
      transformations.push(...parsed.warnings.map((w) => `parser:${w}`));

      // ---- CLEANING ------------------------------------------------------
      await this.setStatus(documentId, DocumentStatus.CLEANING);
      const source = parsed.markdown || parsed.text;
      const isMarkdown = parsed.markdown.length > 0;

      const normalized = await this.stage(
        documentId,
        IngestionStage.NORMALIZE,
        stages,
        () => Promise.resolve(this.normalizer.normalize(source)),
      );
      transformations.push(
        ...normalized.transformations.map((t) => `norm:${t}`),
      );

      const cleaned = await this.stage(
        documentId,
        IngestionStage.CLEAN,
        stages,
        () =>
          Promise.resolve(this.cleaner.clean(normalized.text, { isMarkdown })),
      );
      transformations.push(
        ...cleaned.transformations.map((t) => `clean:${t.name}(${t.count})`),
      );

      const cleanedText = cleaned.text;
      const normalizedHash =
        cleanedText.length > 0
          ? sha256(cleanedText.toLowerCase().replace(/\s+/g, ' ').trim())
          : null;
      const tokenCount = this.tokens.count(cleanedText);

      // ---- VALIDATING: dedup + quality ---------------------------------
      await this.setStatus(documentId, DocumentStatus.VALIDATING);

      const dedup = await this.stage(
        documentId,
        IngestionStage.DEDUPLICATE,
        stages,
        () =>
          this.deduplicator.check({
            checksum: doc.checksum,
            normalizedHash,
            excludeId: documentId,
          }),
      );

      const baseData: Prisma.DocumentUncheckedUpdateInput = {
        parserUsed: PARSER_TYPE_MAP[parsed.parser],
        parsedMarkdown: parsed.markdown || null,
        normalizedHash,
        duplicateOfId: dedup.duplicateOfId,
        transformations: transformations,
      };

      if (dedup.isDuplicate && dedup.type === 'EXACT') {
        return this.reject(
          documentId,
          `Trùng lặp chính xác với document ${dedup.duplicateOfId}`,
          baseData,
          stages,
        );
      }

      const quality = await this.stage(
        documentId,
        IngestionStage.QUALITY,
        stages,
        () =>
          Promise.resolve(
            this.quality.assess({
              text: cleanedText,
              title: doc.title,
              source: doc.source,
              tokenCount,
            }),
          ),
      );

      if (dedup.type === 'NEAR') {
        quality.issues.push({
          type: 'DUPLICATE_CONTENT',
          severity: 'WARNING',
          message: `Gần trùng với document ${dedup.duplicateOfId}`,
        });
      }

      const qualityData: Prisma.DocumentUncheckedUpdateInput = {
        ...baseData,
        cleanedText,
        contentTokens: tokenCount,
        qualityScore: quality.score,
        qualityReport: quality as unknown as Prisma.InputJsonValue,
      };

      if (!quality.valid) {
        return this.reject(
          documentId,
          `Chất lượng không đạt: score ${quality.score} (< ngưỡng) hoặc có lỗi nghiêm trọng`,
          qualityData,
          stages,
        );
      }

      // ---- OK: lưu kết quả, chờ PHASE 2 chunking ----------------------
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          ...qualityData,
          status: DocumentStatus.VALIDATING,
          rejectedReason: null,
        },
      });

      return {
        documentId,
        status: DocumentStatus.VALIDATING,
        qualityScore: quality.score,
        rejectedReason: null,
        duplicateOfId: dedup.duplicateOfId,
        stages,
      };
    } catch (err) {
      const reason =
        err instanceof ParserError
          ? `Parse thất bại [${err.code}]: ${err.message}`
          : err instanceof AppError
            ? `${err.code}: ${err.message}`
            : `Lỗi không xác định: ${(err as Error).message}`;
      this.logger.warn(`Ingestion ${documentId} FAILED — ${reason}`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED, rejectedReason: reason },
      });
      return {
        documentId,
        status: DocumentStatus.FAILED,
        qualityScore: null,
        rejectedReason: reason,
        duplicateOfId: null,
        stages,
      };
    }
  }

  // --- nội bộ ---------------------------------------------------------------

  private async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.prisma.document.update({ where: { id }, data: { status } });
  }

  /** Chạy một stage, ghi `IngestionJob` kèm thời gian, ném lại lỗi nếu có. */
  private async stage<T>(
    documentId: string,
    stage: IngestionStage,
    stages: IngestionResult['stages'],
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date();
    const t0 = Date.now();
    try {
      const value = await fn();
      const ms = Date.now() - t0;
      await this.prisma.ingestionJob.create({
        data: {
          documentId,
          stage,
          status: JobStatus.COMPLETED,
          startedAt,
          finishedAt: new Date(),
          metrics: { ms },
        },
      });
      stages.push({ stage, status: JobStatus.COMPLETED, ms });
      return value;
    } catch (err) {
      const ms = Date.now() - t0;
      await this.prisma.ingestionJob.create({
        data: {
          documentId,
          stage,
          status: JobStatus.FAILED,
          startedAt,
          finishedAt: new Date(),
          error: (err as Error).message,
          metrics: { ms },
        },
      });
      stages.push({ stage, status: JobStatus.FAILED, ms });
      throw err;
    }
  }

  private async reject(
    documentId: string,
    reason: string,
    data: Prisma.DocumentUncheckedUpdateInput,
    stages: IngestionResult['stages'],
  ): Promise<IngestionResult> {
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...data,
        status: DocumentStatus.REJECTED,
        rejectedReason: reason,
      },
    });
    this.logger.log(`Ingestion ${documentId} REJECTED — ${reason}`);
    return {
      documentId,
      status: DocumentStatus.REJECTED,
      qualityScore: updated.qualityScore,
      rejectedReason: reason,
      duplicateOfId: updated.duplicateOfId,
      stages,
    };
  }
}
