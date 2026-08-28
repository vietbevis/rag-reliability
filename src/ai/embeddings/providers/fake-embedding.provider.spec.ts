import { mockConfigService } from '../../../config/config.mock';
import { FakeEmbeddingProvider } from './fake-embedding.provider';

/** Chuẩn L2 của một vector. */
function l2(v: number[]): number {
  return Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
}

function make(dimension = 1536): FakeEmbeddingProvider {
  return new FakeEmbeddingProvider(
    mockConfigService({ embedding: { dimension } }),
  );
}

describe('FakeEmbeddingProvider', () => {
  it('luôn configured và mang tên provider/model cố định', () => {
    const p = make();
    expect(p.isConfigured()).toBe(true);
    expect(p.provider).toBe('fake');
    expect(p.defaultModel).toBe('fake-deterministic-v1');
  });

  it('tất định: cùng text -> vector giống hệt', async () => {
    const p = make();
    const a = await p.embed('quy chế đào tạo');
    const b = await p.embed('quy chế đào tạo');
    expect(a.vector).toEqual(b.vector);
  });

  it('text khác nhau -> vector khác nhau', async () => {
    const p = make();
    const a = await p.embed('điều một');
    const b = await p.embed('điều hai');
    expect(a.vector).not.toEqual(b.vector);
  });

  it('độ dài vector = EMBEDDING_DIMENSION', async () => {
    for (const dim of [128, 768, 1536, 3072]) {
      const p = make(dim);
      expect(p.dimensions).toBe(dim);
      const r = await p.embed('bất kỳ');
      expect(r.vector).toHaveLength(dim);
    }
  });

  it('vector được chuẩn hoá về đơn vị (||v|| ≈ 1)', async () => {
    const p = make(768);
    const r = await p.embed('một đoạn văn bản để test chuẩn hoá');
    expect(l2(r.vector)).toBeCloseTo(1, 5);
  });

  it('embedBatch: 1 vector / input, đúng thứ tự, usage cộng dồn', async () => {
    const p = make(256);
    const texts = ['a', 'bb', 'ccc dddd'];
    const batch = await p.embedBatch(texts);
    expect(batch.vectors).toHaveLength(3);
    expect(batch.model).toBe('fake-deterministic-v1');
    // khớp với embed() từng cái
    for (let i = 0; i < texts.length; i++) {
      const single = await p.embed(texts[i]!);
      expect(batch.vectors[i]).toEqual(single.vector);
    }
    // usage.inputTokens = tổng ceil(len/4)
    const expected = texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
    expect(batch.usage.inputTokens).toBe(expected);
    expect(batch.usage.totalTokens).toBe(expected);
    expect(batch.usage.estimatedCost).toBe(0);
  });

  it('embedBatch rỗng -> vectors rỗng, usage 0', async () => {
    const batch = await make().embedBatch([]);
    expect(batch.vectors).toEqual([]);
    expect(batch.usage.inputTokens).toBe(0);
  });
});
