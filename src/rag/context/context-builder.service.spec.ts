import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type { RetrievedChunk } from '../../common/types';
import { ContextBuilderService } from './context-builder.service';

function chunk(
  id: string,
  score: number,
  content = 'nội dung mẫu',
  extra: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    chunkId: id,
    documentId: extra.documentId ?? 'd0',
    content,
    score,
    source: 'vector',
    metadata: {},
    ...extra,
  };
}

function make(maxContextTokens = 4000) {
  return new ContextBuilderService(
    new TokenCounterService(),
    mockConfigService({ rag: { maxContextTokens } }),
  );
}

describe('ContextBuilderService', () => {
  it('bỏ chunk trùng chunkId, giữ điểm cao hơn', () => {
    const r = make().build([chunk('a', 0.3), chunk('a', 0.9), chunk('b', 0.5)]);
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks.find((c) => c.chunkId === 'a')?.score).toBe(0.9);
  });

  it('sắp xếp theo score giảm dần', () => {
    const r = make().build([chunk('a', 0.2), chunk('b', 0.9), chunk('c', 0.5)]);
    expect(r.chunks.map((c) => c.chunkId)).toEqual(['b', 'c', 'a']);
  });

  it('áp trần token — luôn giữ ít nhất 1 chunk kể cả khi chunk đầu vượt trần', () => {
    const big = 'từ '.repeat(500);
    const r = make(10).build([chunk('a', 0.9, big), chunk('b', 0.8, big)]);
    expect(r.chunks.length).toBe(1);
    expect(r.chunks[0]!.chunkId).toBe('a');
  });

  it('gom sources theo documentId', () => {
    const r = make().build([
      chunk('a', 0.9, 'x', { documentId: 'd1' }),
      chunk('b', 0.8, 'y', { documentId: 'd1' }),
      chunk('c', 0.7, 'z', { documentId: 'd2' }),
    ]);
    const d1 = r.sources.find((s) => s.documentId === 'd1');
    expect(d1?.chunkIds.sort()).toEqual(['a', 'b']);
    expect(r.sources).toHaveLength(2);
  });

  it('renderContext đánh số [i] + breadcrumb section', () => {
    const r = make().build([
      chunk('a', 0.9, 'Điều 1 nội dung', {
        section: 'Quy chế > Chương I',
        page: 3,
      }),
    ]);
    const text = make().renderContext(r);
    expect(text).toContain('[1]');
    expect(text).toContain('(Quy chế > Chương I, tr.3)');
    expect(text).toContain('Điều 1 nội dung');
  });

  it('totalTokens > 0 khi có chunk', () => {
    const r = make().build([chunk('a', 0.9, 'một hai ba bốn năm')]);
    expect(r.totalTokens).toBeGreaterThan(0);
  });
});
