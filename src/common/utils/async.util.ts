/** Resolve sau `ms` mili-giây. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reject với `TimeoutError` nếu `promise` chưa settle trong `ms`. */
export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(`${label ?? 'operation'} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Chạy `task` với hạn `ms`. Khi hết hạn: ném `TimeoutError` VÀ abort
 * `AbortSignal` truyền cho `task` để huỷ luôn công việc đang chạy (vd request
 * HTTP tới LLM) — nếu không, tác vụ "mồ côi" vẫn chạy nền và các lần retry sẽ
 * chồng request lên nhau (PROMPT §52).
 */
export function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(ms, label));
      reject(new TimeoutError(ms, label));
    }, ms);
  });
  const work = Promise.resolve(task(controller.signal)).catch(
    (err: unknown) => {
      // Khi chính timeout đã abort, lỗi huỷ (AbortError) của `task` không được
      // thắng cuộc đua — để nhánh `timeout` ném `TimeoutError` một cách tất định.
      if (controller.signal.aborted) return new Promise<never>(() => {});
      throw err;
    },
  );
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Chia `items` thành các lát liên tiếp, mỗi lát tối đa `size` phần tử. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
