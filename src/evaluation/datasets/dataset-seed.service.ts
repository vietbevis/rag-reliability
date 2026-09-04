import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DocumentsService } from '../../documents/documents.service';
import { sha256 } from '../../common/utils';
import { DocumentStatus, Prisma } from '../../generated/prisma/client';
import type { CorpusDoc, EvalCase } from './case.schema';

/** Gom các field mở rộng của case vào một object JSON để lưu `EvaluationCase.metadata`. */
function caseMetadata(c: EvalCase): Prisma.InputJsonValue {
  return {
    category: c.category ?? null,
    difficulty: c.difficulty,
    reasoningSteps: c.reasoningSteps,
    language: c.language,
    negativeType: c.negativeType,
    expectedAction: c.expectedAction,
    shouldAbstain: c.shouldAbstain,
    acceptableAnswers: c.acceptableAnswers,
    requiredFacts: c.requiredFacts,
    forbiddenClaims: c.forbiddenClaims,
    alternativeDocuments: c.alternativeDocuments,
    distractorDocuments: c.distractorDocuments,
    ...c.metadata,
  };
}

export interface SeedResult {
  datasetId: string;
  caseCount: number;
  /** source → documentId của các tài liệu đã COMPLETED (retrieval được). */
  sourceToDocId: Map<string, string>;
  /** source của các tài liệu không đạt COMPLETED (ghi vào notes của run). */
  notReady: string[];
}

/**
 * Nạp golden dataset vào DB (PROMPT §31):
 * - upsert `EvaluationDataset` + `EvaluationCase`,
 * - ingest `corpus` của mọi case qua `DocumentsService.create` (idempotent:
 *   tài liệu trùng `checksum` đã COMPLETED thì bỏ qua).
 */
@Injectable()
export class DatasetSeedService {
  private readonly logger = new Logger(DatasetSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async seed(datasetName: string, cases: EvalCase[]): Promise<SeedResult> {
    const dataset = await this.prisma.evaluationDataset.upsert({
      where: { name: datasetName },
      create: {
        name: datasetName,
        description: `Golden dataset ${datasetName}`,
      },
      update: { updatedAt: new Date() },
    });

    for (const c of cases) {
      // Field mở rộng (category/difficulty/requiredFacts/…) lưu vào cột
      // `metadata` JSON — không cần migration (xem case.schema.ts).
      const metadata = caseMetadata(c);
      await this.prisma.evaluationCase.upsert({
        where: {
          datasetId_externalId: { datasetId: dataset.id, externalId: c.id },
        },
        create: {
          datasetId: dataset.id,
          externalId: c.id,
          type: c.type,
          question: c.question,
          answerable: c.answerable,
          expectedAnswer: c.expectedAnswer,
          expectedDocuments: c.expectedDocuments,
          expectedChunks: c.expectedChunks,
          metadata,
        },
        update: {
          type: c.type,
          question: c.question,
          answerable: c.answerable,
          expectedAnswer: c.expectedAnswer,
          expectedDocuments: c.expectedDocuments,
          expectedChunks: c.expectedChunks,
          metadata,
        },
      });
    }

    const { sourceToDocId, notReady } = await this.seedCorpus(cases);

    return {
      datasetId: dataset.id,
      caseCount: cases.length,
      sourceToDocId,
      notReady,
    };
  }

  private async seedCorpus(
    cases: EvalCase[],
  ): Promise<{ sourceToDocId: Map<string, string>; notReady: string[] }> {
    const unique = new Map<string, CorpusDoc>();
    for (const c of cases) {
      for (const d of c.corpus) {
        // Khoá khử trùng = source + text (JSON.stringify để không phải chèn ký
        // tự phân cách đặc biệt vào chuỗi).
        unique.set(sha256(JSON.stringify([d.source, d.text])), d);
      }
    }

    const sourceToDocId = new Map<string, string>();
    const notReady: string[] = [];

    for (const d of unique.values()) {
      const checksum = sha256(Buffer.from(d.text, 'utf8'));
      const existing = await this.prisma.document.findFirst({
        where: { checksum, status: DocumentStatus.COMPLETED },
        select: { id: true },
      });
      if (existing) {
        sourceToDocId.set(d.source, existing.id);
        continue;
      }

      const res = await this.documents.create({
        dto: { title: d.title, source: d.source, text: d.text },
      });
      if (res.document.status === DocumentStatus.COMPLETED) {
        sourceToDocId.set(d.source, res.document.id);
      } else {
        notReady.push(d.source);
        this.logger.warn(
          `Corpus "${d.source}" chưa COMPLETED (status ${res.document.status}) — sẽ không truy hồi được`,
        );
      }
    }

    return { sourceToDocId, notReady };
  }
}
