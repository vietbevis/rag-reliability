import {
  contextPrecision,
  contextRecall,
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from './retrieval-metrics';

describe('retrieval-metrics', () => {
  const retrieved = ['a', 'b', 'c', 'd', 'e'];
  const gold = ['b', 'd'];

  describe('recallAtK', () => {
    it('đếm gold trong top-k / tổng gold', () => {
      expect(recallAtK(retrieved, gold, 2)).toBe(0.5); // chỉ 'b'
      expect(recallAtK(retrieved, gold, 5)).toBe(1); // cả 'b' và 'd'
      expect(recallAtK(retrieved, gold, 3)).toBe(0.5);
    });
    it('gold rỗng -> 1', () => {
      expect(recallAtK(retrieved, [], 5)).toBe(1);
    });
    it('không tìm thấy -> 0', () => {
      expect(recallAtK(['x', 'y'], gold, 5)).toBe(0);
    });
  });

  describe('precisionAtK', () => {
    it('gold trong top-k / kích thước top-k', () => {
      expect(precisionAtK(retrieved, gold, 2)).toBe(0.5); // 1/2
      expect(precisionAtK(retrieved, gold, 4)).toBe(0.5); // 2/4
    });
    it('top-k rỗng -> 0', () => {
      expect(precisionAtK([], gold, 5)).toBe(0);
    });
    it('mẫu số = số item thực có nếu ít hơn k', () => {
      expect(precisionAtK(['b'], gold, 5)).toBe(1);
    });
  });

  describe('mrr', () => {
    it('1/hạng của gold đầu tiên', () => {
      expect(mrr(retrieved, gold)).toBe(0.5); // 'b' ở vị trí 2
      expect(mrr(['b', 'a'], gold)).toBe(1);
      expect(mrr(['a', 'c', 'd'], gold)).toBeCloseTo(1 / 3, 4); // 'd' ở hạng 3
    });
    it('không có gold -> 0', () => {
      expect(mrr(['x'], gold)).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('xếp gold lên đầu -> NDCG cao hơn', () => {
      const good = ndcgAtK(['b', 'd', 'a'], gold, 3);
      const bad = ndcgAtK(['a', 'b', 'd'], gold, 3);
      expect(good).toBeGreaterThan(bad);
      expect(good).toBe(1); // gold ở đúng 2 vị trí đầu
    });
    it('gold rỗng -> 1', () => {
      expect(ndcgAtK(retrieved, [], 5)).toBe(1);
    });
    it('không có gold trong top-k -> 0', () => {
      expect(ndcgAtK(['x', 'y', 'z'], gold, 3)).toBe(0);
    });
  });

  describe('contextPrecision', () => {
    it('gold ở đầu -> 1, gold ở cuối -> thấp hơn', () => {
      expect(contextPrecision(['b', 'd', 'x'], gold, 3)).toBe(1);
      expect(contextPrecision(['x', 'y', 'b'], gold, 3)).toBeCloseTo(1 / 3, 4);
    });
    it('không có gold -> 0', () => {
      expect(contextPrecision(['x'], gold, 5)).toBe(0);
    });
  });

  describe('contextRecall', () => {
    it('tính trên toàn danh sách, không giới hạn k', () => {
      expect(contextRecall(retrieved, gold)).toBe(1);
      expect(contextRecall(['a', 'b'], gold)).toBe(0.5);
    });
    it('gold rỗng -> 1', () => {
      expect(contextRecall([], [])).toBe(1);
    });
  });

  it('khử id trùng trước khi tính', () => {
    expect(recallAtK(['b', 'b', 'b', 'd'], gold, 2)).toBe(1); // top-2 sau khử = [b,d] -> đủ 2 gold
    expect(precisionAtK(['b', 'b'], gold, 2)).toBe(1); // top = [b]
  });
});
