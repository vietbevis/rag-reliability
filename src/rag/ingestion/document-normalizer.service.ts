import { Injectable } from '@nestjs/common';

export interface NormalizationResult {
  text: string;
  /** Các phép biến đổi đã áp, để trace (PROMPT §9). */
  transformations: string[];
}

// Dùng `new RegExp` với escape `\\u` để giữ file thuần ASCII (tránh bị mangle
// khi ghi). zero-width space/non-joiner/joiner, word joiner, BOM.
const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');
// soft hyphen (U+00AD).
const SOFT_HYPHEN = new RegExp('\\u00AD', 'g');
// Ký tự điều khiển C0/C1, trừ tab (U+0009) và newline (U+000A).
// prettier-ignore
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]', 'g'); // eslint-disable-line no-control-regex
// Các biến thể khoảng trắng Unicode (không gồm newline, tab, space thường).
const UNICODE_SPACES = new RegExp(
  '[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]',
  'g',
);

/**
 * Chuẩn hoá văn bản **trước khi** clean (PROMPT §9). Chỉ làm những việc an
 * toàn về mặt ngữ nghĩa: mã hoá, ký tự vô hình, xuống dòng. KHÔNG xoá nội
 * dung. Mọi thay đổi đều được ghi vào `transformations`.
 */
@Injectable()
export class DocumentNormalizerService {
  normalize(input: string): NormalizationResult {
    const transformations: string[] = [];
    let text = input;

    const step = (name: string, next: string): void => {
      if (next !== text) {
        transformations.push(name);
        text = next;
      }
    };

    // 1. Chuẩn hoá Unicode về NFC (gộp dấu tổ hợp — quan trọng cho tiếng Việt).
    step('unicode:NFC', text.normalize('NFC'));

    // 2. Bỏ BOM ở đầu file.
    if (text.charCodeAt(0) === 0xfeff) {
      step('strip:BOM', text.slice(1));
    }

    // 3. CRLF / CR -> LF.
    step('newlines:LF', text.replace(/\r\n?/g, '\n'));

    // 4. Bỏ ký tự zero-width và soft hyphen.
    step('strip:zero-width', text.replace(ZERO_WIDTH, ''));
    step('strip:soft-hyphen', text.replace(SOFT_HYPHEN, ''));

    // 5. Bỏ ký tự điều khiển (giữ tab + newline).
    step('strip:control-chars', text.replace(CONTROL_CHARS, ''));

    // 6. Các biến thể khoảng trắng Unicode -> space thường.
    step('whitespace:unicode-spaces', text.replace(UNICODE_SPACES, ' '));

    // 7. Bỏ khoảng trắng cuối mỗi dòng.
    step('whitespace:trailing', text.replace(/[ \t]+$/gm, ''));

    // 8. Gộp >2 dòng trống liên tiếp thành 1 dòng trống.
    step('whitespace:blank-lines', text.replace(/\n{3,}/g, '\n\n'));

    // 9. Trim đầu/cuối toàn văn bản.
    step('whitespace:trim', text.trim());

    return { text, transformations };
  }
}
