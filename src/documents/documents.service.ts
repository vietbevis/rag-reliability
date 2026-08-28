import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../common/errors';
import { sha256 } from '../common/utils';
import {
  IngestionService,
  type IngestionResult,
} from '../rag/ingestion/ingestion.service';
import {
  ChunkingService,
  type ChunkingResult,
} from '../rag/chunking/chunking.service';
import type { ChunkingStrategyName } from '../rag/chunking/chunking.interface';
import {
  ChunkEmbeddingService,
  type EmbeddingRunResult,
} from '../rag/embedding/chunk-embedding.service';
import type { EmbeddingProviderName } from '../ai/llm/llm-provider.enum';
import {
  DocumentStatus,
  type Document,
  type DocumentChunk,
  type Prisma,
} from '../generated/prisma/client';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { ListChunksDto } from './dto/list-chunks.dto';
import type { ListDocumentsDto } from './dto/list-documents.dto';

// Text gửi qua field `text` (không kèm file) mặc định coi là Markdown —
// plain text là tập con hợp lệ của Markdown, và người dùng thường viết có
// cấu trúc (# heading) để structure-aware chunking tận dụng.
const TEXT_MIME_FALLBACK = 'text/markdown';

/** Không trả `rawContent` (byte blob) ra API. */
const OMIT_RAW_CONTENT = { rawContent: true } as const;
export type DocumentView = Omit<Document, 'rawContent'>;

export interface CreateDocumentInput {
  dto: CreateDocumentDto;
  file?: { buffer: Buffer; originalname: string; mimetype: string };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly chunking: ChunkingService,
    private readonly embedding: ChunkEmbeddingService,
  ) {}

  /**
   * Chạy embedding trong pipeline tự động (upload). Lỗi provider (rate limit,
   * API down) KHÔNG làm hỏng cả request — document + chunk đã lưu vẫn hợp lệ.
   * Trả về `{ error }`, document giữ ở `EMBEDDING` để chạy lại qua
   * `POST /documents/:id/embed` (endpoint đó vẫn ném lỗi rõ ràng).
   */
  private async autoEmbed(id: string): Promise<EmbeddingRunResult> {
    try {
      return await this.embedding.embedDocument(id);
    } catch (err) {
      const reason =
        err instanceof AppError
          ? `${err.code}: ${err.message}`
          : ((err as Error)?.message ?? 'unknown');
      this.logger.warn(
        `Auto-embed ${id} thất bại (document + chunk vẫn hợp lệ): ${reason}`,
      );
      return { documentId: id, skipped: false, error: reason };
    }
  }

  /**
   * Tạo document từ file/text, lưu bytes gốc, rồi chạy toàn bộ pipeline có sẵn
   * đồng bộ: ingest → (đạt) chunk → (có provider) embedding. Provider embedding
   * chưa cấu hình thì bỏ qua bước embedding (document dừng ở CHUNKING).
   */
  async create(input: CreateDocumentInput): Promise<{
    document: DocumentView;
    ingestion: IngestionResult;
    chunking: ChunkingResult | null;
    embedding: EmbeddingRunResult | null;
  }> {
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
    const chunking =
      ingestion.status === DocumentStatus.VALIDATING
        ? await this.chunking.chunk(created.id)
        : null;
    const embedding =
      chunking && chunking.chunkCount > 0
        ? await this.autoEmbed(created.id)
        : null;

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: created.id },
      omit: OMIT_RAW_CONTENT,
    });
    return { document, ingestion, chunking, embedding };
  }

  async reingest(id: string): Promise<{
    ingestion: IngestionResult;
    chunking: ChunkingResult | null;
    embedding: EmbeddingRunResult | null;
  }> {
    await this.getOrThrow(id);
    const ingestion = await this.ingestion.ingest(id);
    const chunking =
      ingestion.status === DocumentStatus.VALIDATING
        ? await this.chunking.chunk(id)
        : null;
    const embedding =
      chunking && chunking.chunkCount > 0 ? await this.autoEmbed(id) : null;
    return { ingestion, chunking, embedding };
  }

  async chunk(
    id: string,
    strategy?: ChunkingStrategyName,
  ): Promise<ChunkingResult> {
    await this.getOrThrow(id);
    return this.chunking.chunk(id, strategy);
  }

  async embed(
    id: string,
    provider?: EmbeddingProviderName,
  ): Promise<EmbeddingRunResult> {
    await this.getOrThrow(id);
    return this.embedding.embedDocument(id, provider);
  }

  async embeddingSummary(id: string): Promise<{
    total: number;
    byModel: Array<{
      provider: string;
      model: string;
      dimensions: number;
      count: number;
    }>;
  }> {
    await this.getOrThrow(id);
    const grouped = await this.prisma.embedding.groupBy({
      by: ['provider', 'model', 'dimensions'],
      where: { chunk: { documentId: id } },
      _count: { _all: true },
    });
    return {
      total: grouped.reduce((s, g) => s + g._count._all, 0),
      byModel: grouped.map((g) => ({
        provider: g.provider,
        model: g.model,
        dimensions: g.dimensions,
        count: g._count._all,
      })),
    };
  }

  async listChunks(
    id: string,
    query: ListChunksDto,
  ): Promise<{ total: number; items: DocumentChunk[] }> {
    await this.getOrThrow(id);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.documentChunk.count({ where: { documentId: id } }),
      this.prisma.documentChunk.findMany({
        where: { documentId: id },
        orderBy: { sequence: 'asc' },
        take: query.take,
        skip: query.skip,
      }),
    ]);
    return { total, items };
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
