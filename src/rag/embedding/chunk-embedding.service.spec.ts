import { NotFoundException } from '@nestjs/common';
import { IngestionError } from '../../common/errors';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import { PrismaService } from '../../database/prisma.service';
import { ChunkEmbeddingService } from './chunk-embedding.service';
import { VectorSchemaService } from './vector-schema.service';

interface Overrides {
  doc?: { id: string; status: string } | null;
  chunks?: Array<{ id: string; content: string }>;
  configured?: boolean;
  providerDim?: number;
  columnDim?: number | null;
  vectors?: number[][];
  activeProvider?: string;
  batchModel?: string;
}

/** Vector đã chuẩn hoá để giống output thật (fake provider cũng normalize). */
function unitVec(dim: number, seed: number): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
  const norm = Math.sqrt(raw.reduce((a, x) => a + x * x, 0)) || 1;
  return raw.map((x) => x / norm);
}

function build(o: Overrides = {}) {
  const chunks = o.chunks ?? [
    { id: 'c0', content: 'chunk không' },
    { id: 'c1', content: 'chunk một' },
  ];
  const providerDim = o.providerDim ?? 1536;
  const vectors =
    o.vectors ?? chunks.map((_, i) => unitVec(providerDim, i + 1));

  // mock của các thao tác trong $transaction
  const txEmbeddingDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  // 1 lần cho advisory lock + 1 lần cho mỗi lô INSERT
  const txExecuteRaw = jest.fn().mockResolvedValue(1);
  const txDocumentUpdate = jest.fn().mockResolvedValue({});
  const txIngestionJobCreate = jest.fn().mockResolvedValue({});
  const tx = {
    embedding: { deleteMany: txEmbeddingDeleteMany },
    $executeRaw: txExecuteRaw,
    document: { update: txDocumentUpdate },
    ingestionJob: { create: txIngestionJobCreate },
  };

  const documentFindUnique = jest
    .fn()
    .mockResolvedValue(
      o.doc === undefined ? { id: 'doc-1', status: 'CHUNKING' } : o.doc,
    );
  const documentUpdate = jest.fn().mockResolvedValue({});
  const chunkFindMany = jest.fn().mockResolvedValue(chunks);
  const transaction = jest.fn((cb: (t: typeof tx) => Promise<unknown>) =>
    cb(tx),
  );
  const prisma = {
    document: { findUnique: documentFindUnique, update: documentUpdate },
    documentChunk: { findMany: chunkFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;

  const isConfigured = jest.fn().mockReturnValue(o.configured ?? true);
  const embedBatch = jest.fn().mockResolvedValue({
    vectors,
    usage: {
      inputTokens: 42,
      outputTokens: 0,
      totalTokens: 42,
      estimatedCost: 0,
    },
    model: o.batchModel ?? 'fake-deterministic-v1',
  });
  const embeddings = {
    isConfigured,
    activeProvider: o.activeProvider ?? 'fake',
    activeModel: o.batchModel ?? 'fake-deterministic-v1',
    dimensions: providerDim,
    embedBatch,
  } as unknown as EmbeddingService;

  const getColumnDimension = jest
    .fn()
    .mockResolvedValue(o.columnDim === undefined ? providerDim : o.columnDim);
  const vectorSchema = {
    getColumnDimension,
  } as unknown as VectorSchemaService;

  const svc = new ChunkEmbeddingService(prisma, embeddings, vectorSchema);
  return {
    svc,
    chunks,
    mocks: {
      documentUpdate,
      embedBatch,
      txEmbeddingDeleteMany,
      txExecuteRaw,
      txDocumentUpdate,
      txIngestionJobCreate,
    },
  };
}

describe('ChunkEmbeddingService', () => {
  it('document không tồn tại -> NotFoundException', async () => {
    const { svc } = build({ doc: null });
    await expect(svc.embedDocument('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('status không hợp lệ (UPLOADED) -> IngestionError', async () => {
    const { svc } = build({ doc: { id: 'd', status: 'UPLOADED' } });
    await expect(svc.embedDocument('d')).rejects.toBeInstanceOf(IngestionError);
  });

  it('provider chưa cấu hình -> skipped:true, không đổi status / không insert', async () => {
    const { svc, mocks } = build({ configured: false });
    const r = await svc.embedDocument('doc-1');
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/chưa cấu hình/);
    expect(mocks.documentUpdate).not.toHaveBeenCalled();
    expect(mocks.txExecuteRaw).not.toHaveBeenCalled();
  });

  it('document chưa có chunk -> IngestionError', async () => {
    const { svc } = build({ chunks: [] });
    await expect(svc.embedDocument('doc-1')).rejects.toBeInstanceOf(
      IngestionError,
    );
  });

  it('số chiều provider khác cột DB -> IngestionError', async () => {
    const { svc } = build({ providerDim: 768, columnDim: 1536 });
    await expect(svc.embedDocument('doc-1')).rejects.toThrow(/[Ss]ố chiều/);
  });

  it('cột DB dimensionless (null) -> vẫn chạy được', async () => {
    const { svc } = build({ columnDim: null });
    const r = await svc.embedDocument('doc-1');
    expect(r.skipped).toBe(false);
    expect(r.embeddedChunks).toBe(2);
  });

  it('embedBatch trả thiếu vector -> IngestionError(INGESTION_FAILED)', async () => {
    const { svc } = build({ vectors: [unitVec(1536, 1)] }); // 1 vector cho 2 chunk
    await expect(svc.embedDocument('doc-1')).rejects.toMatchObject({
      code: 'INGESTION_FAILED',
    });
  });

  it('happy path: set EMBEDDING rồi transaction -> COMPLETED, kết quả đầy đủ', async () => {
    const { svc, chunks, mocks } = build();
    const r = await svc.embedDocument('doc-1');

    // đặt status EMBEDDING trước transaction
    expect(mocks.documentUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'EMBEDDING' },
    });
    // transaction: xoá embedding cũ theo model, insert, update COMPLETED, log job
    expect(mocks.txEmbeddingDeleteMany).toHaveBeenCalledWith({
      where: {
        chunkId: { in: chunks.map((c) => c.id) },
        model: 'fake-deterministic-v1',
      },
    });
    expect(mocks.txExecuteRaw).toHaveBeenCalledTimes(2); // advisory lock + 1 lô INSERT
    expect(mocks.txDocumentUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'COMPLETED' },
    });
    expect(mocks.txIngestionJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'EMBED', status: 'COMPLETED' }),
      }),
    );
    expect(mocks.embedBatch).toHaveBeenCalledWith(
      ['chunk không', 'chunk một'],
      { provider: undefined, inputType: 'passage' },
    );

    expect(r).toMatchObject({
      documentId: 'doc-1',
      skipped: false,
      provider: 'fake',
      model: 'fake-deterministic-v1',
      dimensions: 1536,
      embeddedChunks: 2,
      usage: { inputTokens: 42, estimatedCost: 0 },
    });
    expect(typeof r.ms).toBe('number');
  });

  it('nhiều chunk -> chia nhiều lô INSERT (lô theo số chiều)', async () => {
    // dim=64 -> lô = floor(50000/64) = 781; 800 chunk -> 2 lô INSERT
    // txExecuteRaw = 1 (advisory lock) + 2 (INSERT) = 3
    const many = Array.from({ length: 800 }, (_, i) => ({
      id: `c${i}`,
      content: `nội dung ${i}`,
    }));
    const { svc, mocks } = build({
      providerDim: 64,
      chunks: many,
      vectors: many.map((_, i) => unitVec(64, i + 1)),
    });
    await svc.embedDocument('doc-1');
    expect(mocks.txExecuteRaw).toHaveBeenCalledTimes(3);
  });

  it('providerOverride được truyền xuống embedBatch và ghi vào provider', async () => {
    const { svc, mocks } = build();
    const r = await svc.embedDocument('doc-1', 'openai' as never);
    expect(mocks.embedBatch).toHaveBeenCalledWith(expect.any(Array), {
      provider: 'openai',
      inputType: 'passage',
    });
    expect(r.provider).toBe('openai');
  });
});
