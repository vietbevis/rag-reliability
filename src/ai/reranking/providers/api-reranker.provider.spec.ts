import type { ConfigService } from '@nestjs/config';
import type { RetrievedChunk } from '../../../common/types';
import type { AppConfig } from '../../../config/configuration';
import { ApiRerankerProvider } from './api-reranker.provider';

function makeChunk(id: string, content: string, score = 0.5): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'doc-1',
    content,
    score,
    source: 'vector',
    metadata: {},
  };
}

interface RerankCfg {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

function makeConfig(rerank: RerankCfg): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'rerank') return rerank;
      if (key === 'llm') return { timeoutMs: 5000 };
      throw new Error(`unexpected config key ${key}`);
    },
  } as unknown as ConfigService<AppConfig, true>;
}

describe('ApiRerankerProvider', () => {
  const baseCfg: RerankCfg = {
    provider: 'api',
    baseUrl: 'http://localhost:11435/v1',
    model: 'Qwen3-Reranker-0.6B',
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function okResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  it('name là api; isConfigured theo baseUrl + model', () => {
    expect(new ApiRerankerProvider(makeConfig(baseCfg)).name).toBe('api');
    expect(new ApiRerankerProvider(makeConfig(baseCfg)).isConfigured()).toBe(
      true,
    );
    expect(
      new ApiRerankerProvider(
        makeConfig({ provider: 'api', model: 'x' }),
      ).isConfigured(),
    ).toBe(false);
    expect(
      new ApiRerankerProvider(
        makeConfig({ provider: 'api', baseUrl: 'http://x/v1' }),
      ).isConfigured(),
    ).toBe(false);
  });

  it('map relevance_score → rerankScore, sắp giảm dần, cắt topK', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        results: [
          { index: 0, relevance_score: 0.2 },
          { index: 1, relevance_score: 0.95 },
          { index: 2, relevance_score: 0.6 },
        ],
      }),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    const chunks = [
      makeChunk('c1', 'a'),
      makeChunk('c2', 'b'),
      makeChunk('c3', 'c'),
    ];

    const res = await provider.rerank('q', chunks, 2);
    const out = Array.isArray(res) ? res : res.chunks;

    expect(out).toHaveLength(2);
    expect(out[0]?.chunkId).toBe('c2');
    expect(out[0]?.rerankScore).toBeCloseTo(0.95, 4);
    expect(out[0]?.rank).toBe(0);
    expect(out[1]?.chunkId).toBe('c3');
    expect(out[1]?.rank).toBe(1);
  });

  it('POST tới <baseUrl>/rerank với body Jina + không header auth khi thiếu key', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ results: [{ index: 0, relevance_score: 1 }] }),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    await provider.rerank('câu hỏi', [makeChunk('c1', 'nội dung')], 5);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11435/v1/rerank');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'Qwen3-Reranker-0.6B',
      query: 'câu hỏi',
      documents: ['nội dung'],
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('gắn Authorization: Bearer khi có apiKey', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ results: [{ index: 0, relevance_score: 1 }] }),
    );
    const provider = new ApiRerankerProvider(
      makeConfig({ ...baseCfg, apiKey: 'secret-key' }),
    );
    await provider.rerank('q', [makeChunk('c1', 'x')], 5);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-key');
  });

  it('chấp nhận mảng bare [{index, score}] (TEI shape)', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([
        { index: 1, score: 0.9 },
        { index: 0, score: 0.1 },
      ]),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    const res = await provider.rerank(
      'q',
      [makeChunk('c1', 'a'), makeChunk('c2', 'b')],
      5,
    );
    const out = Array.isArray(res) ? res : res.chunks;
    expect(out[0]?.chunkId).toBe('c2');
    expect(out[1]?.chunkId).toBe('c1');
  });

  it('score ngoài [0,1] (logit) được ép về (0,1) bằng sigmoid, giữ thứ tự', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        results: [
          { index: 0, relevance_score: -4 },
          { index: 1, relevance_score: 5 },
        ],
      }),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    const res = await provider.rerank(
      'q',
      [makeChunk('c1', 'a'), makeChunk('c2', 'b')],
      5,
    );
    const out = Array.isArray(res) ? res : res.chunks;
    expect(out[0]?.chunkId).toBe('c2');
    expect(out[0]?.rerankScore).toBeGreaterThan(0);
    expect(out[0]?.rerankScore).toBeLessThanOrEqual(1);
    expect(out[1]?.rerankScore).toBeGreaterThan(0);
    expect(out[1]?.rerankScore).toBeLessThan(0.5);
  });

  it('chunk không được server nhắc tới nhận rerankScore 0 và xếp cuối', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ results: [{ index: 2, relevance_score: 0.7 }] }),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    const res = await provider.rerank(
      'q',
      [makeChunk('c1', 'a'), makeChunk('c2', 'b'), makeChunk('c3', 'c')],
      3,
    );
    const out = Array.isArray(res) ? res : res.chunks;
    expect(out[0]?.chunkId).toBe('c3');
    expect(out[1]?.rerankScore).toBe(0);
    expect(out[2]?.rerankScore).toBe(0);
  });

  it('HTTP 500 → ném để RerankerService fallback identity', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    await expect(
      provider.rerank('q', [makeChunk('c1', 'x')], 5),
    ).rejects.toThrow(/500/);
  });

  it('timeout → ném TimeoutError', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const provider = new ApiRerankerProvider(makeConfig({ ...baseCfg }));
    // timeout cấu hình 5000ms — dùng fake timers để không chờ thật
    jest.useFakeTimers();
    const p = provider.rerank('q', [makeChunk('c1', 'x')], 5);
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await jest.advanceTimersByTimeAsync(6000);
    await assertion;
    jest.useRealTimers();
  });

  it('input chunks rỗng → trả rỗng, không gọi fetch', async () => {
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    const res = await provider.rerank('q', [], 5);
    const out = Array.isArray(res) ? res : res.chunks;
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cắt document dài ~1200 ký tự trước khi gửi', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ results: [{ index: 0, relevance_score: 1 }] }),
    );
    const provider = new ApiRerankerProvider(makeConfig(baseCfg));
    await provider.rerank('q', [makeChunk('c1', 'A'.repeat(3000))], 5);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { documents: string[] };
    expect(body.documents[0]!.length).toBeLessThan(1300);
  });
});
