import { Logger } from '@nestjs/common';
import { type LlmErrorKind } from '../../common/errors';
import { sleep, withTimeout, TimeoutError } from '../../common/utils';

/**
 * Phân loại lỗi độc lập với provider (PROMPT §52). Ánh xạ bất kỳ lỗi nào mà SDK
 * hoặc LangChain ném ra sang một {@link LlmErrorKind} ổn định kèm quyết định
 * có retry hay không.
 */
export function classifyProviderError(err: unknown): {
  kind: LlmErrorKind;
  retryable: boolean;
} {
  if (err instanceof TimeoutError) return { kind: 'TIMEOUT', retryable: true };

  const anyErr = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  const status = anyErr.status ?? anyErr.statusCode;
  const message = (anyErr.message ?? '').toLowerCase();
  const code = (anyErr.code ?? '').toLowerCase();

  if (
    code === 'econnreset' ||
    code === 'econnrefused' ||
    code === 'etimedout' ||
    code === 'enotfound' ||
    anyErr.name === 'FetchError'
  ) {
    return { kind: 'NETWORK', retryable: true };
  }

  if (status === 401 || status === 403 || message.includes('api key')) {
    return { kind: 'AUTH', retryable: false };
  }
  if (status === 429 || message.includes('rate limit')) {
    return { kind: 'RATE_LIMIT', retryable: true };
  }
  if (message.includes('quota') || message.includes('resource_exhausted')) {
    return { kind: 'QUOTA', retryable: false };
  }
  if (
    message.includes('safety') ||
    message.includes('blocked') ||
    message.includes('recitation')
  ) {
    return { kind: 'SAFETY_BLOCK', retryable: false };
  }
  if (
    message.includes('context length') ||
    message.includes('maximum context') ||
    message.includes('too many tokens') ||
    message.includes('max_tokens')
  ) {
    return { kind: 'TOKEN_LIMIT', retryable: false };
  }
  if (status === 529 || message.includes('overloaded')) {
    return { kind: 'OVERLOADED', retryable: true };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'SERVER_ERROR', retryable: true };
  }
  if (status === 400 || status === 422) {
    return { kind: 'BAD_REQUEST', retryable: false };
  }
  return { kind: 'UNKNOWN', retryable: false };
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  timeoutMs: number;
  label: string;
  logger?: Logger;
}

/**
 * Chạy `fn` với timeout cho từng lần thử và exponential backoff có giới hạn kèm
 * full jitter. Chỉ retry các lỗi được phân loại là `retryable`; mọi lỗi khác
 * (và lần thử cuối cùng) sẽ ném lại. Không bao giờ lặp vô hạn (PROMPT §52).
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<{ value: T; attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      const value = await withTimeout(fn, opts.timeoutMs, opts.label);
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const { kind, retryable } = classifyProviderError(err);
      const isLast = attempt === opts.maxRetries + 1;
      if (!retryable || isLast) {
        opts.logger?.warn(
          `${opts.label} failed (${kind}) on attempt ${attempt}/${opts.maxRetries + 1}` +
            (retryable ? ' — retries exhausted' : ' — not retryable'),
        );
        throw err;
      }
      const backoff = opts.baseDelayMs * 2 ** (attempt - 1);
      const delay = Math.random() * Math.min(backoff, 30_000);
      opts.logger?.debug(
        `${opts.label} failed (${kind}), retrying in ${Math.round(delay)}ms (attempt ${attempt})`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}
