/**
 * Lớp cơ sở cho mọi lỗi domain trong service. Mỗi stage của pipeline RAG ném ra
 * một lớp con kèm `code` ổn định, máy đọc được, để có thể phân loại, ghi log và
 * trả về mà không lộ nội bộ (PROMPT §54).
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  /** HTTP status dùng khi lỗi này thoát ra tới biên API. */
  readonly httpStatus: number = 500;

  /** Việc thử lại cùng thao tác có khả năng thành công hay không. */
  readonly retryable: boolean = false;

  constructor(
    message: string,
    readonly context?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      name: this.name,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export class ConfigError extends AppError {
  readonly code = 'CONFIG_ERROR';
  override readonly httpStatus = 500;
}

export class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR';
  override readonly httpStatus = 503;
}

export class ParserError extends AppError {
  readonly code: string;
  override readonly httpStatus = 422;

  constructor(
    code:
      | 'PARSER_UNAVAILABLE'
      | 'UNSUPPORTED_MIME'
      | 'PARSE_FAILED'
      | 'NEEDS_OCR'
      | 'ENCRYPTED'
      | 'MALFORMED'
      | 'EMPTY_OUTPUT',
    message: string,
    context?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, context, options);
    this.code = code;
  }
}

export type LlmErrorKind =
  | 'RATE_LIMIT'
  | 'TOKEN_LIMIT'
  | 'QUOTA'
  | 'SAFETY_BLOCK'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'AUTH'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'UNKNOWN';

export class LlmError extends AppError {
  readonly code = 'LLM_ERROR';
  override readonly httpStatus: number;
  override readonly retryable: boolean;

  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    context?: Record<string, unknown>,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { ...context, kind }, options);
    this.retryable =
      options?.retryable ??
      [
        'RATE_LIMIT',
        'OVERLOADED',
        'TIMEOUT',
        'SERVER_ERROR',
        'NETWORK',
      ].includes(kind);
    this.httpStatus =
      kind === 'AUTH' ? 502 : kind === 'BAD_REQUEST' ? 400 : 502;
  }
}

export class EmbeddingError extends AppError {
  readonly code = 'EMBEDDING_ERROR';
  override readonly httpStatus = 502;

  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    context?: Record<string, unknown>,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { ...context, kind }, options);
  }
}
