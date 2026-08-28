import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { sha256 } from '../common/utils';
import {
  IngestionService,
  type IngestionResult,
} from '../rag/ingestion/ingestion.service';
import type { Document, Prisma } from '../generated/prisma/client';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { ListDocumentsDto } from './dto/list-documents.dto';

const TEXT_MIME_FALLBACK = 'text/plain';

/** Không trả `rawContent` (byte blob) ra API. */
const OMIT_RAW_CONTENT = { rawContent: true } as const;
export type DocumentView = Omit<Document, 'rawContent'>;

export interface CreateDocumentInput {
  dto: CreateDocumentDto;
  file?: { buffer: Buffer; originalname: string; mimetype: string };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  /**
   * Tạo document từ file hoặc text, lưu bytes gốc, rồi chạy ingestion đồng bộ
   * (anydoc rất nhanh — PROMPT §5.4). Trả về document + kết quả ingestion.
   */
  async create(
    input: CreateDocumentInput,
  ): Promise<{ document: DocumentView; ingestion: IngestionResult }> {
    const { dto, file } = input;

    const bytes: Buffer = file
      ? file.buffer
      : Buffer.from(dto.text ?? '', 'utf8');
    if (bytes.length === 0) {
      throw new BadRequestException(
        'Cần upload `file` hoặc gửi `text` không rỗng',
      );
    }

    const mimeType =
      file?.mimetype ?? dto.mimeType ?? (dto.text ? TEXT_MIME_FALLBACK : null);
    if (!mimeType) {
      throw new BadRequestException('Không xác định được mimeType');
    }

    const title = dto.title ?? file?.originalname ?? 'untitled';
    const source = dto.source ?? file?.originalname ?? 'api';
    const checksum = sha256(bytes);

    // @@unique([checksum, version]) — lần upload trùng bytes sẽ là version kế
    // tiếp; ingestion sẽ REJECT nó là exact-duplicate.
    const priorVersions = await this.prisma.document.count({
      where: { checksum },
    });

    const created = await this.prisma.document.create({
      data: {
        title,
        source,
        mimeType,
        checksum,
        version: priorVersions + 1,
        rawContent: new Uint8Array(bytes),
        rawText: isTextMime(mimeType) ? bytes.toString('utf8') : null,
        metadata: (file
          ? { originalName: file.originalname, size: bytes.length }
          : { size: bytes.length }) satisfies Prisma.InputJsonValue,
      },
    });

    const ingestion = await this.ingestion.ingest(created.id);
    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: created.id },
      omit: OMIT_RAW_CONTENT,
    });
    return { document, ingestion };
  }

  async reingest(id: string): Promise<IngestionResult> {
    await this.getOrThrow(id);
    return this.ingestion.ingest(id);
  }

  async findOne(id: string): Promise<DocumentView> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      omit: OMIT_RAW_CONTENT,
    });
    if (!doc) throw new NotFoundException(`Document ${id} không tồn tại`);
    return doc;
  }

  async findMany(query: ListDocumentsDto): Promise<{
    total: number;
    items: Array<
      Pick<
        Document,
        | 'id'
        | 'title'
        | 'source'
        | 'mimeType'
        | 'status'
        | 'parserUsed'
        | 'qualityScore'
        | 'version'
        | 'createdAt'
      >
    >;
  }> {
    const where = query.status ? { status: query.status } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
        select: {
          id: true,
          title: true,
          source: true,
          mimeType: true,
          status: true,
          parserUsed: true,
          qualityScore: true,
          version: true,
          createdAt: true,
        },
      }),
    ]);
    return { total, items };
  }

  async listJobs(
    id: string,
  ): Promise<
    Array<{ stage: string; status: string; error: string | null; ms: number }>
  > {
    await this.getOrThrow(id);
    const jobs = await this.prisma.ingestionJob.findMany({
      where: { documentId: id },
      orderBy: { createdAt: 'asc' },
    });
    return jobs.map((j) => ({
      stage: j.stage,
      status: j.status,
      error: j.error,
      ms: Number((j.metrics as { ms?: number })?.ms ?? 0),
    }));
  }

  private async getOrThrow(id: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} không tồn tại`);
    return doc;
  }
}

function isTextMime(mime: string): boolean {
  const m = mime.split(';')[0]?.trim() ?? mime;
  return m.startsWith('text/') || m === 'application/json';
}
