import { Logger } from '@nestjs/common';
import type { RetrievalService } from '../../rag/retrieval/retrieval.service';
import type { ToolExecutionContext } from '../core/tool.types';
import { RagSearchTool } from './rag-search.tool';

const ctx: ToolExecutionContext = {
  runId: 'run-1',
  stepId: 'run-1:0',
  providerId: 'local',
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
});
