import { classifyProviderError, withRetry } from './retry.util';
import { TimeoutError } from '../../common/utils';

describe('classifyProviderError', () => {
  it('phân loại rate limit là retryable', () => {
    expect(classifyProviderError({ status: 429 })).toEqual({
      kind: 'RATE_LIMIT',
      retryable: true,
    });
  });

  it('phân loại lỗi auth là không retryable', () => {
    expect(classifyProviderError({ status: 401 }).retryable).toBe(false);
    expect(classifyProviderError({ status: 401 }).kind).toBe('AUTH');
  });

  it('nhận diện overloaded của Anthropic (529)', () => {
    expect(classifyProviderError({ status: 529 })).toEqual({
      kind: 'OVERLOADED',
      retryable: true,
    });
  });

  it('nhận diện safety filter của Gemini', () => {
    const r = classifyProviderError(
      new Error('response was blocked by safety'),
    );
    expect(r).toEqual({ kind: 'SAFETY_BLOCK', retryable: false });
  });

  it('nhận diện vượt giới hạn token', () => {
    const r = classifyProviderError(
      new Error('maximum context length exceeded'),
    );
    expect(r.kind).toBe('TOKEN_LIMIT');
    expect(r.retryable).toBe(false);
  });

  it('lỗi 5xx là retryable', () => {
    expect(classifyProviderError({ status: 503 }).retryable).toBe(true);
  });

  it('TimeoutError là retryable', () => {
    expect(classifyProviderError(new TimeoutError(10)).kind).toBe('TIMEOUT');
  });
});

describe('withRetry', () => {
  const opts = {
    maxRetries: 2,
    baseDelayMs: 1,
    timeoutMs: 1000,
    label: 'test',
  };

  it('trả về kết quả ngay khi thành công lần đầu', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const res = await withRetry(fn, opts);
    expect(res).toEqual({ value: 'ok', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retry lỗi retryable rồi thành công', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    const res = await withRetry(fn, opts);
    expect(res.value).toBe('ok');
    expect(res.attempts).toBe(2);
  });

  it('không retry lỗi không retryable', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 401 });
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dừng sau maxRetries + 1 lần thử', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, opts)).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('áp timeout cho từng lần thử', async () => {
    const fn = () => new Promise((r) => setTimeout(() => r('late'), 50));
    await expect(
      withRetry(fn, { ...opts, timeoutMs: 5, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
