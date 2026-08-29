import type { RetrievedChunk } from '../../common/types';
import { fuse, type FusionConfig, type RetrieverOutput } from './fusion';

const c = (
  id: string,
  score: number,
  source: RetrievedChunk['source'] = 'vector',
): RetrievedChunk => ({
  chunkId: id,
  documentId: 'd0',
  content: id,
  score,
  source,
  metadata: {},
});

const RRF: FusionConfig = {
  method: 'rrf',
  rrfK: 60,
  weights: { vector: 1, keyword: 1, graph: 1 },
};

describe('fuse', () => {
  it('rỗng → []', () => {
    expect(fuse([], RRF, 10)).toEqual([]);
  });

  it('một nguồn → chỉ cắt topK, giữ nguyên score/source', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.9), c('b', 0.5), c('c', 0.1)] },
    ];
    const r = fuse(out, RRF, 2);
    expect(r.map((x) => x.chunkId)).toEqual(['a', 'b']);
    expect(r[0]!.score).toBe(0.9);
    expect(r[0]!.source).toBe('vector');
  });

  it('RRF: chunk xuất hiện ở nhiều nguồn top-rank → điểm cộng dồn, lên đầu', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('x', 0.9), c('a', 0.8)] },
      {
        source: 'keyword',
        chunks: [c('x', 0.5, 'keyword'), c('b', 0.4, 'keyword')],
      },
    ];
    const r = fuse(out, RRF, 10);
    expect(r[0]!.chunkId).toBe('x');
    expect(r[0]!.source).toBe('hybrid');
    expect(r[0]!.metadata.fusion).toMatchObject({
      method: 'rrf',
      fromSources: expect.arrayContaining(['vector', 'keyword']),
    });
  });

  it('chunk #1 ở MỌI nguồn → score = 1 (đạt trần lý thuyết)', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.9), c('b', 0.5)] },
      { source: 'graph', chunks: [c('a', 0.8, 'graph')] },
    ];
    const r = fuse(out, RRF, 10);
    expect(r[0]!.chunkId).toBe('a');
    expect(r[0]!.score).toBe(1);
  });

  it('MỌI kết quả yếu (mỗi nguồn 1 chunk rác) → score KHÔNG bị thổi lên 1.0', () => {
    // a chỉ ở vector (rank 1/1 nguồn), b chỉ ở keyword — không chunk nào ở cả 2
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.03)] },
      { source: 'keyword', chunks: [c('b', 0.01, 'keyword')] },
    ];
    const r = fuse(out, RRF, 10);
    // trần lý thuyết = 2·(1/(60+1)); mỗi chunk chỉ đạt 1·(1/61) → score ≈ 0.5
    for (const x of r) {
      expect(x.score).toBeLessThan(0.6);
      expect(x.score).toBeGreaterThan(0);
    }
    expect(r[0]!.metadata.fusion).toMatchObject({
      rawScore: expect.any(Number),
    });
  });

  it('weighted: dùng score chuẩn hoá * trọng số', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.4)] },
      { source: 'keyword', chunks: [c('b', 0.9, 'keyword')] },
    ];
    const weighted: FusionConfig = {
      method: 'weighted',
      rrfK: 60,
      weights: { vector: 2, keyword: 0.1 },
    };
    const r = fuse(out, weighted, 10);
    // a: 2*0.4=0.8 ; b: 0.1*0.9=0.09 → a đứng đầu
    expect(r[0]!.chunkId).toBe('a');
  });

  it('bỏ nguồn rỗng, không nhân đôi chunk trùng id', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.9)] },
      { source: 'keyword', chunks: [] },
      { source: 'graph', chunks: [c('a', 0.7, 'graph')] },
    ];
    const r = fuse(out, RRF, 10);
    expect(r).toHaveLength(1);
    expect(r[0]!.chunkId).toBe('a');
  });
});
