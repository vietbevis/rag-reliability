import type { ParsedDocument, ParserType } from '../../common/types';

export type { ParsedDocument, ParserType };

export interface ParserInput {
  bytes: Uint8Array;
  /** Tên file gốc, dùng để đoán format theo phần mở rộng (CSV, v.v.). */
  filename?: string;
  mimeType: string;
}

/**
 * Parser tài liệu chuyển bytes thô thành text (+ Markdown khi có cấu trúc).
 * Các hiện thực phải ném `ParserError` kèm code cụ thể khi thất bại để factory
 * có thể fallback hoặc từ chối một cách rõ ràng (PROMPT §5.3, §54).
 */
export interface DocumentParser {
  readonly type: ParserType;
  /** Parser này có xử lý được MIME type đã cho hay không. */
  supports(mimeType: string): boolean;
  /** Hiện thực bên dưới có dùng được trong môi trường này hay không. */
  isAvailable(): Promise<boolean>;
  parse(input: ParserInput): Promise<ParsedDocument>;
}
