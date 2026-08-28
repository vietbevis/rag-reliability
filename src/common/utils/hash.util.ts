import { createHash } from 'node:crypto';

/** SHA-256 hex của một chuỗi hoặc buffer — checksum của document/chunk (PROMPT §11). */
export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Checksum trên text đã *chuẩn hoá*: lowercase, gộp khoảng trắng, trim. Hai
 * đoạn text chỉ khác nhau về khoảng trắng/hoa-thường sẽ cho cùng hash — nền
 * tảng cho việc phát hiện trùng lặp chính xác trước khi chấm điểm near-duplicate.
 */
export function normalizedTextHash(text: string): string {
  const normalized = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return sha256(normalized);
}
