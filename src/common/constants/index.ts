/** Hằng số xuyên suốt. Các giá trị tinh chỉnh nằm ở config; đây là hằng cấu trúc. */

export const API_PREFIX = 'api';
export const SWAGGER_PATH = 'docs';

/** Các MIME type mà anydoc chuyển đổi native (PROMPT §5.1). */
export const ANYDOC_MIME_TYPES: readonly string[] = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  'text/rtf',
  'application/epub+zip',
  'text/csv',
  'application/pdf',
];

export const PLAIN_TEXT_MIME_TYPES: readonly string[] = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
];

export const HTML_MIME_TYPES: readonly string[] = [
  'text/html',
  'application/xhtml+xml',
];
