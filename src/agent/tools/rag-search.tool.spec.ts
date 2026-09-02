import { Logger } from '@nestjs/common';
import type { RetrievalService } from '../../rag/retrieval/retrieval.service';
import type { AgentToolContext } from './tool.interface';
import { RagSearchTool } from './rag-search.tool';

const ctx: AgentToolContext = {
  agentRunId: 'run-1',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

type RetrieveFn = RetrievalService['retrieve'];

function toolWith(retrieve: RetrieveFn): RagSearchTool {
  return new RagSearchTool({ retrieve } as unknown as RetrievalService);
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
  it('metadata: read, tên snake_case', () => {
    expect(toolWith(jest.fn()).name).toBe('rag_search');
    expect(toolWith(jest.fn()).access).toBe('read');
  });

  it('map chunk → data + evidence kind=chunk + cost', async () => {
    const tool = toolWith(() =>
      Promise.resolve(response({ chunks: [chunk()] })),
    );
    const res = await tool.execute({ query: 'bảo lưu mấy kỳ' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data.chunkCount).toBe(1);
    expect(res.data.chunks[0]).toMatchObject({
      chunkId: 'c1',
      documentId: 'd1',
      score: 0.9123,
      source: 'vector',
    });
    expect(res.evidence).toEqual([
      {
        kind: 'chunk',
        ref: 'c1',
        text: 'Sinh viên được bảo lưu tối đa hai học kỳ.',
      },
    ]);
    expect(res.usage?.estimatedCost).toBeCloseTo(0.0002);
  });

  it('source=graph → evidence kind=graph', async () => {
    const tool = toolWith(() =>
      Promise.resolve(
        response({
          strategy: 'graph',
          chunks: [chunk({ source: 'graph' })],
        }),
      ),
    );
    const res = await tool.execute({ query: 'q', strategy: 'graph' }, ctx);
    expect(res.evidence[0]?.kind).toBe('graph');
  });

  it('lỗi hạ tầng (res.error) → ok:false, không che thành rỗng', async () => {
    const tool = toolWith(() =>
      Promise.resolve(response({ error: 'embed query failed' })),
    );
    const res = await tool.execute({ query: 'q' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/embed query failed/);
    expect(res.evidence).toHaveLength(0);
  });

  it('content dài bị cắt trong data (evidence giữ toàn văn) + truncated=true', async () => {
    const long = 'x'.repeat(5000);
    const tool = toolWith(() =>
      Promise.resolve(response({ chunks: [chunk({ content: long })] })),
    );
    const res = await tool.execute({ query: 'q' }, ctx);
    expect(res.data.chunks[0]!.content.length).toBeLessThan(long.length);
    expect(res.data.chunks[0]!.content.endsWith('…')).toBe(true);
    expect(res.evidence[0]!.text).toBe(long);
    expect(res.truncated).toBe(true);
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

  it('topK mặc định = 6 khi không truyền', async () => {
    const retrieve = jest
      .fn<ReturnType<RetrieveFn>, Parameters<RetrieveFn>>()
      .mockResolvedValue(response());
    await toolWith(retrieve).execute({ query: 'abc' }, ctx);
    expect(retrieve.mock.calls[0]![0]).toMatchObject({ topK: 6 });
  });
});
