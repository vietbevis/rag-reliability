import type { RetrievedChunk } from '../../common/types';
import { NoopRerankerProvider } from './providers/noop-reranker.provider';
import type { RerankerFactoryService } from './reranker-factory.service';
import type { RerankerProvider } from './reranker.interface';
import { RerankerService } from './reranker.service';

function makeChunk(
  id: string,
  score: number,
  content = 'content',
): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'doc-1',
    content,
    score,
    source: 'vector',
    metadata: {},
  };
}

describe('RerankerService', () => {
  let noopProvider: NoopRerankerProvider;
  let mockFactory: { create: jest.Mock; activeName: string };
  let service: RerankerService;

  beforeEach(() => {
    noopProvider = new NoopRerankerProvider();
    mockFactory = {
      create: jest.fn(),
      activeName: 'none',
    };
    service = new RerankerService(
      mockFactory as unknown as RerankerFactoryService,
      noopProvider,
    );
  });

  it('chunks rỗng trả về kết quả rỗng ngay với method none và fellBack false', async () => {
    const result = await service.rerank('query', [], 5);

    expect(result).toEqual({
      chunks: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
      latencyMs: 0,
      method: 'none',
      fellBack: false,
    });
    expect(mockFactory.create).not.toHaveBeenCalled();
  });

  it('hoạt động thành công với provider bình thường', async () => {
    const chunks = [makeChunk('c1', 0.7), makeChunk('c2', 0.9)];
    const mockProvider: RerankerProvider = {
      name: 'llm',
      isConfigured: () => true,
      rerank: jest.fn().mockResolvedValueOnce({
        chunks: [
          { ...chunks[1], rerankScore: 0.9, rank: 0 },
          { ...chunks[0], rerankScore: 0.7, rank: 1 },
        ],
        usage: { inputTokens: 50, outputTokens: 20, estimatedCost: 0.0005 },
      }),
    };
    mockFactory.create.mockReturnValue(mockProvider);

    const result = await service.rerank('query', chunks, 2);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.chunkId).toBe('c2');
    expect(result.method).toBe('llm');
    expect(result.fellBack).toBe(false);
    expect(result.usage.inputTokens).toBe(50);
  });

  it('bắt lỗi khi provider ném exception và fallback về noop identity (fellBack = true)', async () => {
    const chunks = [makeChunk('c1', 0.7), makeChunk('c2', 0.9)];
    const failingProvider: RerankerProvider = {
      name: 'llm',
      isConfigured: () => true,
      rerank: jest.fn().mockRejectedValueOnce(new Error('LLM API Timeout')),
    };
    mockFactory.create.mockReturnValue(failingProvider);

    const result = await service.rerank('query', chunks, 2);

    expect(result.chunks).toHaveLength(2);
    const [c1Result, c2Result] = result.chunks;
    // Identity fallback: giữ nguyên thứ tự ban đầu c1, c2
    expect(c1Result?.chunkId).toBe('c1');
    expect(c1Result?.rerankScore).toBe(0.7);
    expect(c1Result?.rank).toBe(0);

    expect(c2Result?.chunkId).toBe('c2');
    expect(c2Result?.rerankScore).toBe(0.9);
    expect(c2Result?.rank).toBe(1);

    expect(result.method).toBe('llm');
    expect(result.fellBack).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    });
  });

  it('fallback nếu provider trả về mảng rỗng khi input có chunk', async () => {
    const chunks = [makeChunk('c1', 0.8)];
    const buggyProvider: RerankerProvider = {
      name: 'custom',
      isConfigured: () => true,
      rerank: jest.fn().mockResolvedValueOnce([]),
    };
    mockFactory.create.mockReturnValue(buggyProvider);

    const result = await service.rerank('query', chunks, 2);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.chunkId).toBe('c1');
    expect(result.fellBack).toBe(true);
    expect(result.method).toBe('custom');
  });

  it('truyền override provider xuống factory', async () => {
    const chunks = [makeChunk('c1', 0.5)];
    mockFactory.create.mockReturnValue(noopProvider);

    await service.rerank('query', chunks, 1, 'fake');

    expect(mockFactory.create).toHaveBeenCalledWith('fake');
  });
});
