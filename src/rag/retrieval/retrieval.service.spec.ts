import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import type { RetrievedChunk } from '../../common/types';
import { VectorRetrieverService } from './vector-retriever.service';
import { RetrievalService } from './retrieval.service';

function build(
  chunks: RetrievedChunk[],
  logThrows = false,
  vectorTrace: Record<string, unknown> = { model: 'm' },
) {
  const create = logThrows
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue({});
  const prisma = {
    retrievalLog: { create },
  } as unknown as PrismaService;

  const vector = {
    retrieve: jest.fn().mockResolvedValue({
      chunks,
      latencyMs: 3,
      embeddingTokens: 7,
      estimatedCost: 0.002,
      trace: vectorTrace,
    }),
  } as unknown as VectorRetrieverService;

  const config = mockConfigService({ rag: { retrievalTopK: 20 } });
  return {
    svc: new RetrievalService(prisma, vector, config),
    logCreate: create,
    vectorRetrieve: vector.retrieve as jest.Mock,
  };
}

const chunk = (id: string): RetrievedChunk => ({
  chunkId: id,
  documentId: 'd0',
  content: 'x',
  score: 0.5,
  source: 'vector',
  metadata: {},
});

describe('RetrievalService (PHASE 4 = vector only)', () => {
  it('gọi vector retriever với topK mặc định, trả chunk + usage', async () => {
    const { svc, vectorRetrieve } = build([chunk('a'), chunk('b')]);
    const r = await svc.retrieve({ query: 'q' });
    expect(r.strategy).toBe('vector');
    expect(r.chunks).toHaveLength(2);
    expect(r.usage).toEqual({ embeddingTokens: 7, estimatedCost: 0.002 });
    expect(vectorRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'q', topK: 20 }),
    );
  });

  it('ghi RetrievalLog mặc định, kèm ragQueryId nếu có', async () => {
    const { svc, logCreate } = build([chunk('a')]);
    await svc.retrieve({ query: 'q', ragQueryId: 'rq1' });
    expect(logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ragQueryId: 'rq1',
          strategy: 'vector',
          query: 'q',
        }),
      }),
    );
  });

  it('log=false -> không ghi RetrievalLog', async () => {
    const { svc, logCreate } = build([chunk('a')]);
    await svc.retrieve({ query: 'q', log: false });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('lỗi ghi log KHÔNG làm hỏng retrieval', async () => {
    const { svc } = build([chunk('a')], true);
    await expect(svc.retrieve({ query: 'q' })).resolves.toMatchObject({
      chunks: [chunk('a')],
    });
  });

  it('lỗi hạ tầng của vector retriever (trace.error) -> response.error', async () => {
    const { svc } = build([], false, { error: 'embed_query_failed' });
    const r = await svc.retrieve({ query: 'q', log: false });
    expect(r.error).toBe('embed_query_failed');
    expect(r.chunks).toEqual([]);
  });

  it('retriever "skipped" (chưa cấu hình) KHÔNG phải error hạ tầng', async () => {
    const { svc } = build([], false, { skipped: 'provider chưa cấu hình' });
    const r = await svc.retrieve({ query: 'q', log: false });
    expect(r.error).toBeUndefined();
  });
});
