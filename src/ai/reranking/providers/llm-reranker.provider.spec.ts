import type { RetrievedChunk } from '../../../common/types';
import type { LlmService } from '../../llm/llm.service';
import type { LlmFactoryService } from '../../llm/llm-factory.service';
import { LlmRerankerProvider } from './llm-reranker.provider';

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

describe('LlmRerankerProvider', () => {
  let llmService: { chatStructured: jest.Mock };
  let llmFactory: { create: jest.Mock };
  let provider: LlmRerankerProvider;

  beforeEach(() => {
    llmService = {
      chatStructured: jest.fn(),
    };
    llmFactory = {
      create: jest.fn().mockReturnValue({
        isConfigured: () => true,
      }),
    };
    provider = new LlmRerankerProvider(
      llmService as unknown as LlmService,
      llmFactory as unknown as LlmFactoryService,
    );
  });

  it('name là llm và isConfigured delegate tới llmFactory', () => {
    expect(provider.name).toBe('llm');
    expect(provider.isConfigured()).toBe(true);
    expect(llmFactory.create).toHaveBeenCalled();
  });

  it('map đúng relevance sang rerankScore (/ 10) và sắp xếp giảm dần', async () => {
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 'nội dung chunk 1'),
      makeChunk('c2', 'nội dung chunk 2'),
      makeChunk('c3', 'nội dung chunk 3'),
    ];

    llmService.chatStructured.mockResolvedValueOnce({
      data: {
        ranking: [
          { index: 1, relevance: 6 },
          { index: 2, relevance: 9 },
          { index: 3, relevance: 3 },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 30, estimatedCost: 0.001 },
      model: 'test-model',
      provider: 'openai',
      latencyMs: 150,
    });

    const result = await provider.rerank('câu hỏi', chunks, 2);

    expect(result.chunks).toHaveLength(2);
    const [c2Result, c1Result] = result.chunks;
    // c2 có relevance 9 -> rerankScore 0.9 -> rank 0
    expect(c2Result?.chunkId).toBe('c2');
    expect(c2Result?.rerankScore).toBe(0.9);
    expect(c2Result?.rank).toBe(0);

    // c1 có relevance 6 -> rerankScore 0.6 -> rank 1
    expect(c1Result?.chunkId).toBe('c1');
    expect(c1Result?.rerankScore).toBe(0.6);
    expect(c1Result?.rank).toBe(1);

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      estimatedCost: 0.001,
    });
  });

  it('chunk không được nhắc tới sẽ có rerankScore = 0 và xếp xuống cuối', async () => {
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 'nội dung chunk 1'),
      makeChunk('c2', 'nội dung chunk 2'),
      makeChunk('c3', 'nội dung chunk 3'),
    ];

    // LLM chỉ nhắc tới index 3
    llmService.chatStructured.mockResolvedValueOnce({
      data: {
        ranking: [{ index: 3, relevance: 8 }],
      },
      usage: { inputTokens: 50, outputTokens: 10, estimatedCost: 0 },
      model: 'test-model',
      provider: 'openai',
      latencyMs: 100,
    });

    const result = await provider.rerank('câu hỏi', chunks, 3);

    expect(result.chunks).toHaveLength(3);
    const [first, second, third] = result.chunks;
    expect(first?.chunkId).toBe('c3');
    expect(first?.rerankScore).toBe(0.8);
    expect(first?.rank).toBe(0);

    expect(second?.chunkId).toBe('c1');
    expect(second?.rerankScore).toBe(0);
    expect(second?.rank).toBe(1);

    expect(third?.chunkId).toBe('c2');
    expect(third?.rerankScore).toBe(0);
    expect(third?.rank).toBe(2);
  });

  it('ném lỗi khi LLM trả về ranking rỗng để service có thể fallback', async () => {
    const chunks: RetrievedChunk[] = [makeChunk('c1', 'nội dung chunk 1')];

    llmService.chatStructured.mockResolvedValueOnce({
      data: {
        ranking: [],
      },
      usage: { inputTokens: 10, outputTokens: 2, estimatedCost: 0 },
    });

    await expect(provider.rerank('câu hỏi', chunks, 5)).rejects.toThrow(
      /ranking rỗng hoặc không hợp lệ/i,
    );
  });

  it('xử lý input chunks rỗng an toàn mà không gọi LLM', async () => {
    const result = await provider.rerank('câu hỏi', [], 5);
    expect(result.chunks).toEqual([]);
    expect(result.usage?.inputTokens).toBe(0);
    expect(llmService.chatStructured).not.toHaveBeenCalled();
  });
});
