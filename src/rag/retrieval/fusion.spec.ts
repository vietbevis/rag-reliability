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

  it('score hợp nhất chuẩn hoá về [0,1] (đỉnh = 1)', () => {
    const out: RetrieverOutput[] = [
      { source: 'vector', chunks: [c('a', 0.9), c('b', 0.5)] },
      { source: 'graph', chunks: [c('a', 0.8, 'graph')] },
    ];
    const r = fuse(out, RRF, 10);
    expect(r[0]!.score).toBe(1);
    for (const x of r) {
      expect(x.score).toBeGreaterThanOrEqual(0);
      expect(x.score).toBeLessThanOrEqual(1);
    }
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
