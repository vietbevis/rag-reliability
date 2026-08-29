import type { RetrievedChunk } from '../../../common/types';
import { FakeRerankerProvider } from './fake-reranker.provider';

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

describe('FakeRerankerProvider', () => {
  let provider: FakeRerankerProvider;

  beforeEach(() => {
    provider = new FakeRerankerProvider();
  });

  it('name là fake và luôn isConfigured', () => {
    expect(provider.name).toBe('fake');
    expect(provider.isConfigured()).toBe(true);
  });

  it('chunk chứa nhiều token query hơn sẽ được xếp trên', async () => {
    const query = 'học phí học kỳ một';
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 'thông báo nghỉ tết nguyên đán'), // 0 match
      makeChunk('c2', 'quy định đóng học phí năm học mới'), // 2 matches (học, phí)
      makeChunk('c3', 'mức thu học phí học kỳ một năm 2026'), // 4 matches (học, phí, kỳ, một)
    ];

    const result = await provider.rerank(query, chunks, 3);

    expect(result).toHaveLength(3);
    const [first, second, third] = result;
    expect(first?.chunkId).toBe('c3');
    expect(first?.rank).toBe(0);
    expect((first?.rerankScore ?? 0) > (second?.rerankScore ?? 0)).toBe(true);

    expect(second?.chunkId).toBe('c2');
    expect(second?.rank).toBe(1);
    expect((second?.rerankScore ?? 0) > (third?.rerankScore ?? 0)).toBe(true);

    expect(third?.chunkId).toBe('c1');
    expect(third?.rank).toBe(2);
    expect(third?.rerankScore).toBe(0);
  });

  it('tất định khi chạy nhiều lần với cùng input', async () => {
    const query = 'bảo lưu kết quả học tập';
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 'thời gian đào tạo chuẩn'),
      makeChunk('c2', 'thủ tục xin bảo lưu kết quả học tập'),
      makeChunk('c3', 'kết quả học tập và rèn luyện'),
    ];

    const run1 = await provider.rerank(query, chunks, 3);
    const run2 = await provider.rerank(query, chunks, 3);

    expect(run1).toEqual(run2);
  });

  it('cắt đúng topK', async () => {
    const query = 'thông tin';
    const chunks: RetrievedChunk[] = [
      makeChunk('c1', 'thông tin một'),
      makeChunk('c2', 'thông tin hai'),
      makeChunk('c3', 'thông tin ba'),
    ];

    const result = await provider.rerank(query, chunks, 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.rank).toBe(0);
    expect(result[1]?.rank).toBe(1);
  });

  it('xử lý query rỗng hoặc chunks rỗng an toàn', async () => {
    const chunks: RetrievedChunk[] = [makeChunk('c1', 'nội dung')];
    const resEmptyQuery = await provider.rerank('', chunks, 5);
    expect(resEmptyQuery).toHaveLength(1);
    expect(resEmptyQuery[0]?.rerankScore).toBe(0);

    const resEmptyChunks = await provider.rerank('query', [], 5);
    expect(resEmptyChunks).toEqual([]);
  });
});
