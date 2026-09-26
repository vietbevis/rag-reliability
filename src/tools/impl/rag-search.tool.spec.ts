import { Logger } from '@nestjs/common';
import type { RetrievalService } from '../../rag/retrieval/retrieval.service';
import type { ToolExecutionContext } from '../core/tool.types';
import type { PrismaService } from '../../database/prisma.service';
import { RagSearchTool } from './rag-search.tool';

const ctx: ToolExecutionContext = {
  runId: 'run-1',
  stepId: 'run-1:0',
  providerId: 'local',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

type RetrieveFn = RetrievalService['retrieve'];

const DOCS = [
  { id: 'd1', title: 'HUST_quyche-daotao-2023.pdf' },
  { id: 'd2', title: 'HUST_quyche-daotao-2018.pdf' },
  { id: 'd3', title: 'HCMUS_quyche-daotao-DH-2021.pdf' },
];

/** Prisma giả: `document.findMany` lọc theo `where.id.in` nếu có. */
function fakePrisma(): PrismaService {
  return {
    document: {
      findMany: jest.fn((args: { where?: { id?: { in?: string[] } } } = {}) => {
        const ids = args.where?.id?.in;
        return Promise.resolve(
          ids ? DOCS.filter((d) => ids.includes(d.id)) : DOCS,
        );
      }),
    },
  } as unknown as PrismaService;
}

function toolWith(retrieve: RetrieveFn): RagSearchTool {
  return new RagSearchTool(
    { retrieve } as unknown as RetrievalService,
    fakePrisma(),
  );
}

function response(over: Partial<Awaited<ReturnType<RetrieveFn>>> = {}) {
  return {
    query: 'q',
    strategy: 'hybrid' as const,
    chunks: [],
    latencyMs: 5,
    usage: { embeddingTokens: 3, estimatedCost: 0.0002 },
    trace: {},
    ...over,
  };
}

const chunk = (over: Record<string, unknown> = {}) => ({
  chunkId: 'c1',
  documentId: 'd1',
  content: 'Sinh viên được bảo lưu tối đa hai học kỳ.',
  score: 0.912345,
  source: 'vector' as const,
  metadata: {},
  ...over,
});

describe('RagSearchTool', () => {
  it('metadata: id rag.search, local read-only', () => {
    const t = toolWith(jest.fn());
    expect(t.definition.id).toBe('rag.search');
    expect(t.definition.metadata.source).toBe('local');
  });

  it('map chunk → data + evidence kind=chunk + cost', async () => {
    const tool = toolWith(() =>
      Promise.resolve(response({ chunks: [chunk()] })),
    );
    const res = await tool.execute({ query: 'bảo lưu mấy kỳ' }, ctx);

    expect(res.success).toBe(true);
    expect(res.data?.chunkCount).toBe(1);
    expect(res.data?.chunks[0]).toMatchObject({
      chunkId: 'c1',
      score: 0.9123,
      source: 'vector',
    });
    expect(res.evidence[0]).toMatchObject({
      kind: 'chunk',
      ref: 'c1',
      text: 'Sinh viên được bảo lưu tối đa hai học kỳ.',
    });
    expect(res.usage?.estimatedCost).toBeCloseTo(0.0002);
  });

  it('source=graph → evidence kind=graph', async () => {
    const tool = toolWith(() =>
      Promise.resolve(
        response({ strategy: 'graph', chunks: [chunk({ source: 'graph' })] }),
      ),
    );
    const res = await tool.execute({ query: 'q', strategy: 'graph' }, ctx);
    expect(res.evidence[0]?.kind).toBe('graph');
  });

  it('lỗi hạ tầng → success:false + RAG_RETRIEVAL_ERROR retryable', async () => {
    const tool = toolWith(() =>
      Promise.resolve(response({ error: 'embed query failed' })),
    );
    const res = await tool.execute({ query: 'q' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('RAG_RETRIEVAL_ERROR');
    expect(res.error?.retryable).toBe(true);
    expect(res.evidence).toHaveLength(0);
  });

  it('content dài bị cắt trong data, evidence giữ toàn văn', async () => {
    const long = 'x'.repeat(5000);
    const tool = toolWith(() =>
      Promise.resolve(response({ chunks: [chunk({ content: long })] })),
    );
    const res = await tool.execute({ query: 'q' }, ctx);
    expect(res.data!.chunks[0]!.content.length).toBeLessThan(long.length);
    expect(res.evidence[0]!.text).toBe(long);
    expect(res.metadata?.truncated).toBe(true);
  });

  it('truyền query/topK/strategy xuống RetrievalService, log=false', async () => {
    const retrieve = jest
      .fn<ReturnType<RetrieveFn>, Parameters<RetrieveFn>>()
      .mockResolvedValue(response());
    await toolWith(retrieve).execute(
      { query: 'abc', topK: 3, strategy: 'keyword' },
      ctx,
    );
    expect(retrieve).toHaveBeenCalledWith({
      query: 'abc',
      topK: 3,
      strategy: 'keyword',
      log: false,
    });
  });

  describe('lọc theo tài liệu (document)', () => {
    it('"HUST 2023" → chỉ truy hồi trong tài liệu khớp mọi từ của tên', async () => {
      const retrieve = jest.fn(() => Promise.resolve(response()));
      const tool = toolWith(retrieve);
      await tool.execute(
        { query: 'tín chỉ tối đa', document: 'HUST 2023' },
        ctx,
      );
      expect(retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ filters: { documentIds: ['d1'] } }),
      );
    });

    it('khớp nhiều tài liệu → lọc theo tất cả', async () => {
      const retrieve = jest.fn(() => Promise.resolve(response()));
      const tool = toolWith(retrieve);
      await tool.execute({ query: 'x', document: 'hust' }, ctx);
      expect(retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ filters: { documentIds: ['d1', 'd2'] } }),
      );
    });

    it('không tài liệu nào khớp → TOOL_ARGUMENT_ERROR kèm danh sách tên, không truy hồi', async () => {
      const retrieve = jest.fn(() => Promise.resolve(response()));
      const tool = toolWith(retrieve);
      const res = await tool.execute({ query: 'x', document: 'NEU 2024' }, ctx);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('TOOL_ARGUMENT_ERROR');
      expect(res.error?.message).toContain('HCMUS_quyche-daotao-DH-2021.pdf');
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('không truyền document → không lọc', async () => {
      const retrieve = jest.fn(() => Promise.resolve(response()));
      const tool = toolWith(retrieve);
      await tool.execute({ query: 'x' }, ctx);
      expect(retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ filters: undefined }),
      );
    });
  });

  it('mỗi chunk trả về kèm documentTitle để model biết nguồn thuộc văn bản nào', async () => {
    const tool = toolWith(() =>
      Promise.resolve(response({ chunks: [chunk({ documentId: 'd2' })] })),
    );
    const res = await tool.execute({ query: 'x' }, ctx);
    expect(res.data?.chunks[0]?.documentTitle).toBe(
      'HUST_quyche-daotao-2018.pdf',
    );
  });
});
