import { bootstrapCI } from './statistics';

describe('bootstrapCI', () => {
  it('mảng rỗng -> null', () => {
    expect(bootstrapCI([])).toBeNull();
  });

  it('một phần tử -> CI suy biến', () => {
    expect(bootstrapCI([1])).toEqual({
      mean: 1,
      low: 1,
      high: 1,
      marginOfError: 0,
      n: 1,
    });
  });

  it('tất định theo seed: hai lần chạy cho cùng kết quả', () => {
    const v = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0];
    expect(bootstrapCI(v, { seed: 42 })).toEqual(bootstrapCI(v, { seed: 42 }));
  });

  it('low <= mean <= high và margin >= 0', () => {
    const v = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const ci = bootstrapCI(v)!;
    expect(ci.low).toBeLessThanOrEqual(ci.mean);
    expect(ci.mean).toBeLessThanOrEqual(ci.high);
    expect(ci.marginOfError).toBeGreaterThanOrEqual(0);
    expect(ci.n).toBe(40);
  });

  it('mẫu lớn hơn -> khoảng hẹp hơn', () => {
    const small = bootstrapCI(Array.from({ length: 10 }, (_, i) => i % 2))!;
    const large = bootstrapCI(Array.from({ length: 200 }, (_, i) => i % 2))!;
    expect(large.marginOfError).toBeLessThan(small.marginOfError);
  });

  it('toàn bộ giống nhau -> khoảng bằng 0', () => {
    const ci = bootstrapCI([1, 1, 1, 1, 1])!;
    expect(ci.low).toBe(1);
    expect(ci.high).toBe(1);
  });
});
