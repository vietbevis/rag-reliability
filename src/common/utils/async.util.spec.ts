import { chunkArray, sleep, TimeoutError, withTimeout } from './async.util';

describe('async.util', () => {
  it('sleep chờ khoảng thời gian tối thiểu', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('withTimeout trả về giá trị khi kịp hạn', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('withTimeout ném TimeoutError khi quá hạn', async () => {
    const slow = sleep(50).then(() => 'late');
    await expect(withTimeout(slow, 10, 'probe')).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('chunkArray chia đúng kích thước lô', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 3)).toEqual([]);
    expect(() => chunkArray([1], 0)).toThrow();
  });
});
