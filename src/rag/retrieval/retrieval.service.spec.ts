import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import type { RetrievedChunk } from '../../common/types';
import type { RetrieverResult } from './retriever.interface';
import { VectorRetrieverService } from './vector-retriever.service';
import { KeywordRetrieverService } from './keyword-retriever.service';
import { GraphRetrieverService } from './graph-retriever.service';
import { RetrievalService } from './retrieval.service';

const chunk = (
  id: string,
  score: number,
  source = 'vector',
): RetrievedChunk => ({
  chunkId: id,
  documentId: 'd0',
  content: `nội dung ${id}`,
  score,
  source: source as RetrievedChunk['source'],
  metadata: {},
});

function res(
  chunks: RetrievedChunk[],
  trace: Record<string, unknown> = {},
): RetrieverResult {
  return { chunks, latencyMs: 1, embeddingTokens: 0, estimatedCost: 0, trace };
}

function build(
  opts: {
    vector?: RetrieverResult;
    keyword?: RetrieverResult;
    graph?: RetrieverResult;
    strategy?: 'vector' | 'keyword' | 'graph' | 'hybrid';
    logThrows?: boolean;
  } = {},
) {
  const create = opts.logThrows
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue({});
  const prisma = {
    retrievalLog: { create },
  } as unknown as PrismaService;

  const vector = {
    retrieve: jest
      .fn()
      .mockResolvedValue(opts.vector ?? res([chunk('a', 0.9)])),
  } as unknown as VectorRetrieverService;
  const keyword = {
    retrieve: jest
      .fn()
      .mockResolvedValue(opts.keyword ?? res([chunk('b', 0.8, 'keyword')])),
  } as unknown as KeywordRetrieverService;
  const graph = {
    retrieve: jest
      .fn()
      .mockResolvedValue(opts.graph ?? res([chunk('c', 0.7, 'graph')])),
  } as unknown as GraphRetrieverService;

  const config = mockConfigService({
    rag: { retrievalTopK: 20 },
    retrieval: { strategy: opts.strategy ?? 'vector' },
  });

  return {
    svc: new RetrievalService(prisma, vector, keyword, graph, config),
    vector: vector.retrieve as jest.Mock,
    keyword: keyword.retrieve as jest.Mock,
    graph: graph.retrieve as jest.Mock,
    logCreate: create,
  };
}

describe('RetrievalService (PHASE 6 — strategy + fusion)', () => {
  it('mặc định vector: chỉ gọi vector retriever', async () => {
    const { svc, vector, keyword, graph } = build();
    const r = await svc.retrieve({ query: 'q' });
    expect(r.strategy).toBe('vector');
    expect(vector).toHaveBeenCalled();
    expect(keyword).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(r.chunks.map((c) => c.chunkId)).toEqual(['a']);
  });

  it('strategy=keyword override: chỉ gọi keyword', async () => {
    const { svc, vector, keyword } = build();
    const r = await svc.retrieve({ query: 'q', strategy: 'keyword' });
    expect(r.strategy).toBe('keyword');
    expect(keyword).toHaveBeenCalled();
    expect(vector).not.toHaveBeenCalled();
  });

  it('hybrid: gọi cả 3, fusion hợp nhất, source hybrid khi trùng', async () => {
    const { svc, vector, keyword, graph } = build({
      strategy: 'hybrid',
      vector: res([chunk('x', 0.9), chunk('y', 0.5)]),
      keyword: res([chunk('x', 0.7, 'keyword')]),
      graph: res([chunk('z', 0.6, 'graph')]),
    });
    const r = await svc.retrieve({ query: 'q' });
    expect(vector).toHaveBeenCalled();
    expect(keyword).toHaveBeenCalled();
    expect(graph).toHaveBeenCalled();
    const x = r.chunks.find((c) => c.chunkId === 'x')!;
    expect(x.source).toBe('hybrid'); // vector + keyword
    // x xuất hiện ở 2 nguồn top-rank → phải đứng đầu
    expect(r.chunks[0]!.chunkId).toBe('x');
  });

  it('hybrid: 1 nguồn lỗi hạ tầng, 2 nguồn sống → KHÔNG error, vẫn có kết quả', async () => {
    const { svc } = build({
      strategy: 'hybrid',
      vector: res([], { error: 'embed_query_failed' }),
      keyword: res([chunk('b', 0.8, 'keyword')]),
      graph: res([chunk('c', 0.7, 'graph')]),
    });
    const r = await svc.retrieve({ query: 'q' });
    expect(r.error).toBeUndefined();
    expect(r.chunks.length).toBeGreaterThan(0);
  });

  it('hybrid: MỌI nguồn lỗi hạ tầng → error được set', async () => {
    const { svc } = build({
      strategy: 'hybrid',
      vector: res([], { error: 'embed_query_failed' }),
      keyword: res([], { error: 'db_down' }),
      graph: res([], { error: 'graph_retrieval_failed' }),
    });
    const r = await svc.retrieve({ query: 'q' });
    expect(r.error).toBeDefined();
  });

  it('vector: lỗi hạ tầng của nó = error toàn cục', async () => {
    const { svc } = build({ vector: res([], { error: 'embed_query_failed' }) });
    const r = await svc.retrieve({ query: 'q' });
    expect(r.error).toBe('embed_query_failed');
  });

  it('graph "no_seed_entity" (reason, không phải error) → KHÔNG error', async () => {
    const { svc } = build({
      strategy: 'graph',
      graph: res([], { reason: 'no_seed_entity' }),
    });
    const r = await svc.retrieve({ query: 'q' });
    expect(r.error).toBeUndefined();
    expect(r.chunks).toEqual([]);
  });

  it('lỗi ghi RetrievalLog KHÔNG làm hỏng retrieval', async () => {
    const { svc } = build({ logThrows: true });
    await expect(svc.retrieve({ query: 'q' })).resolves.toMatchObject({
      chunks: [chunk('a', 0.9)],
    });
  });

  it('hybrid: 1 retriever NÉM (vi phạm hợp đồng) → cô lập, nguồn khác vẫn chạy', async () => {
    const config = mockConfigService({
      rag: { retrievalTopK: 20 },
      retrieval: { strategy: 'hybrid' },
    });
    const vector = {
      retrieve: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as VectorRetrieverService;
    const keyword = {
      retrieve: jest.fn().mockResolvedValue(res([chunk('b', 0.8, 'keyword')])),
    } as unknown as KeywordRetrieverService;
    const graph = {
      retrieve: jest.fn().mockResolvedValue(res([])),
    } as unknown as GraphRetrieverService;
    const prisma = {
      retrievalLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;

    const svc = new RetrievalService(prisma, vector, keyword, graph, config);
    const r = await svc.retrieve({ query: 'q' });
    expect(r.chunks.length).toBeGreaterThan(0); // keyword vẫn có kết quả
    expect(r.error).toBeUndefined(); // 1/3 fail, không phải toàn bộ
  });

  it('fusion weighted: dùng score chuẩn hoá * trọng số', async () => {
    const config = mockConfigService({
      rag: { retrievalTopK: 20 },
      retrieval: {
        strategy: 'hybrid',
        fusion: {
          method: 'weighted',
          rrfK: 60,
          weights: { vector: 2, keyword: 0.1, graph: 0.1 },
        },
      },
    });
    const vector = {
      retrieve: jest.fn().mockResolvedValue(res([chunk('a', 0.4)])),
    } as unknown as VectorRetrieverService;
    const keyword = {
      retrieve: jest.fn().mockResolvedValue(res([chunk('b', 0.9, 'keyword')])),
    } as unknown as KeywordRetrieverService;
    const graph = {
      retrieve: jest.fn().mockResolvedValue(res([])),
    } as unknown as GraphRetrieverService;
    const prisma = {
      retrievalLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;

    const svc = new RetrievalService(prisma, vector, keyword, graph, config);
    const r = await svc.retrieve({ query: 'q' });
    // a: 2·0.4 = 0.8 ; b: 0.1·0.9 = 0.09 → a đứng đầu
    expect(r.chunks[0]!.chunkId).toBe('a');
  });
});
