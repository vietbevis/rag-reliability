import type { RetrievedChunk } from '../../../common/types';
import { NoopRerankerProvider } from './noop-reranker.provider';

function makeChunk(
  id: string,
  score: number,
  content = 'text',
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

describe('NoopRerankerProvider', () => {
  let provider: NoopRerankerProvider;

  beforeEach(() => {
    provider = new NoopRerankerProvider();
  });

  it('name là none và luôn isConfigured', () => {
    expect(provider.name).toBe('none');
    expect(provider.isConfigured()).toBe(true);
  });

  it('giữ nguyên thứ tự, rerankScore = score, gán rank = i và cắt topK', async () => {
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 0.8),
      makeChunk('c2', 0.5),
      makeChunk('c3', 0.9),
    ];

    const result = await provider.rerank('query', chunks, 2);

    expect(result).toHaveLength(2);
    const [c1Result, c2Result] = result;
    expect(c1Result).toEqual({
      ...chunks[0],
      rerankScore: 0.8,
      rank: 0,
    });
    expect(c2Result).toEqual({
      ...chunks[1],
      rerankScore: 0.5,
      rank: 1,
    });
  });

  it('xử lý mảng rỗng an toàn', async () => {
    const result = await provider.rerank('query', [], 5);
    expect(result).toEqual([]);
  });
});
