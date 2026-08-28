import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IngestionError } from '../../common/errors';
import { normalizedTextHash } from '../../common/utils';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import {
  DocumentStatus,
  IngestionStage,
  JobStatus,
  type Prisma,
} from '../../generated/prisma/client';
import type { ChunkingStrategyName } from './chunking.interface';
import { ChunkerFactoryService } from './chunker-factory.service';
import { ChunkQualityService } from './chunk-quality.service';

const CHUNKABLE_STATUSES: DocumentStatus[] = [
  DocumentStatus.VALIDATING,
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.COMPLETED,
];

export interface ChunkingResult {
  documentId: string;
  strategy: ChunkingStrategyName;
  chunkCount: number;
  totalTokens: number;
  avgTokens: number;
  avgQuality: number;
  duplicateChunks: number;
  flagCounts: Record<string, number>;
  ms: number;
}

/**
 * Điều phối chunking (PROMPT §12, §13). Đầu vào là document đã qua PHASE 1
 * (status `VALIDATING`). Ghi `DocumentChunk` + điểm chất lượng, phát hiện
 * chunk trùng lặp, rồi chuyển document sang `CHUNKING` (chờ PHASE 3 embedding).
 */
@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: ChunkerFactoryService,
    private readonly quality: ChunkQualityService,
    private readonly tokens: TokenCounterService,
  ) {}

  async chunk(
    documentId: string,
    strategyOverride?: ChunkingStrategyName,
  ): Promise<ChunkingResult> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc)
      throw new NotFoundException(`Document ${documentId} không tồn tại`);
    if (!CHUNKABLE_STATUSES.includes(doc.status)) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        `Document ở trạng thái ${doc.status}, phải qua PHASE 1 (VALIDATING) trước khi chunk`,
      );
    }
    if (!doc.cleanedText) {
      throw new IngestionError(
        'INGESTION_PRECONDITION',
        'Document chưa có cleanedText',
      );
    }

    const t0 = Date.now();
    const strategy = this.factory.create(strategyOverride);

    const raw = await strategy.split({
      markdown: doc.parsedMarkdown ?? undefined,
      text: doc.cleanedText,
    });

    // Phát hiện chunk trùng lặp (exact, theo normalized hash) trong cùng document.
    const hashes = raw.map((r) => normalizedTextHash(r.content));
    const seen = new Set<string>();
    const isDup = hashes.map((h) => {
      const dup = seen.has(h);
      seen.add(h);
      return dup;
    });

    const flagCounts: Record<string, number> = {};
    let totalTokens = 0;
    let totalQuality = 0;

    const rows: Prisma.DocumentChunkCreateManyInput[] = raw.map((r, i) => {
      const tokenCount =
        (r.metadata.tokenCount as number | undefined) ??
        this.tokens.count(r.content);
      const q = this.quality.assess({
        content: r.content,
        tokenCount,
        hasHeading: !!r.heading || !!r.section,
        isDuplicate: isDup[i],
      });
      for (const f of q.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
      totalTokens += tokenCount;
      totalQuality += q.score;

      return {
        documentId,
        content: r.content,
        contentHash: hashes[i]!,
        sequence: i,
        tokenCount,
        heading: r.heading ?? null,
        section: r.section ?? null,
        page: r.page ?? null,
        qualityScore: q.score,
        metadata: {
          ...r.metadata,
          strategy: strategy.name,
          qualityFlags: q.flags,
          isDuplicate: isDup[i],
        },
      };
    });

    await this.prisma.$transaction([
      this.prisma.documentChunk.deleteMany({ where: { documentId } }),
      ...(rows.length > 0
        ? [this.prisma.documentChunk.createMany({ data: rows })]
        : []),
      this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.CHUNKING },
      }),
      this.prisma.ingestionJob.create({
        data: {
          documentId,
          stage: IngestionStage.CHUNK,
          status: JobStatus.COMPLETED,
          startedAt: new Date(t0),
          finishedAt: new Date(),
          metrics: {
            strategy: strategy.name,
            chunkCount: rows.length,
            totalTokens,
            ms: Date.now() - t0,
          },
        },
      }),
    ]);

    const result: ChunkingResult = {
      documentId,
      strategy: strategy.name,
      chunkCount: rows.length,
      totalTokens,
      avgTokens: rows.length ? Math.round(totalTokens / rows.length) : 0,
      avgQuality: rows.length
        ? Number((totalQuality / rows.length).toFixed(3))
        : 0,
      duplicateChunks: isDup.filter(Boolean).length,
      flagCounts,
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Chunked ${documentId}: ${result.chunkCount} chunk (${strategy.name}), ` +
        `avg ${result.avgTokens} tok, q ${result.avgQuality}`,
    );
    return result;
  }
}
