/**
 * Tiện ích văn bản dùng chung (không phụ thuộc domain).
 */

/**
 * Cụm nghi vấn tiếng Việt (nhiều từ) — loại BỎ trước khi tách token vì chúng
 * gần như không bao giờ xuất hiện trong văn bản quy chế nhưng lại ép
 * `websearch_to_tsquery` thành phép AND bắt buộc → 0 kết quả.
 */
const VI_INTERROGATIVE_PHRASES: readonly string[] = [
  'như thế nào',
  'thế nào',
  'bao nhiêu',
  'bao lâu',
  'khi nào',
  'tại sao',
  'vì sao',
  'là gì',
  'ra sao',
  'có phải',
  'hay không',
  'được không',
  'gồm những gì',
];

/**
 * Từ dừng + từ nghi vấn tiếng Việt (một từ). Giữ danh sách gọn, tập trung vào
 * hư từ và từ để hỏi — KHÔNG loại từ mang nghĩa.
 */
const VI_STOPWORDS: ReadonlySet<string> = new Set([
  'là',
  'và',
  'của',
  'các',
  'một',
  'những',
  'được',
  'cho',
  'trong',
  'khi',
  'thì',
  'mà',
  'này',
  'đó',
  'đây',
  'đấy',
  'với',
  'để',
  'có',
  'không',
  'phải',
  'hay',
  'hoặc',
  'nếu',
  'như',
  'về',
  'từ',
  'theo',
  'tại',
  'do',
  'bởi',
  'vì',
  'nên',
  'ra',
  'vào',
  'lại',
  'qua',
  'đã',
  'đang',
  'sẽ',
  'cũng',
  'rất',
  'nhưng',
  'tuy',
  'dù',
  'mỗi',
  'từng',
  'quá',
  'lắm',
  'tôi',
  'bạn',
  'chỉ',
  'còn',
  'gì',
  'nào',
  'đâu',
  'ai',
  'mấy',
  'sao',
  'chăng',
  'ư',
  'nhỉ',
  'nhé',
  'thế',
  'bao',
  'liệu',
  'xin',
  'hỏi',
  'cho biết',
  'muốn',
  'cần',
]);

/**
 * Chuẩn hoá một câu hỏi tự nhiên thành chuỗi truy vấn từ khoá cho PostgreSQL
 * Full-Text Search: loại cụm/từ nghi vấn và hư từ, nối các token còn lại bằng
 * toán tử `or` để `websearch_to_tsquery` KHÔNG ép AND toàn bộ.
 *
 * Sửa lỗi docs/audit/RETRIEVAL_BENCHMARK.md §3.1 (keyword Recall@5 = 0 trên câu
 * hỏi tự nhiên). Trả về chuỗi rỗng nếu không còn token nghĩa nào — nơi gọi tự
 * quyết định fallback.
 */
export function toKeywordQuery(raw: string): string {
  if (!raw) return '';
  let text = raw.normalize('NFC').toLowerCase();

  for (const phrase of VI_INTERROGATIVE_PHRASES) {
    text = text.split(phrase).join(' ');
  }

  const tokens = text.match(/[\p{L}\p{N}]+(?:[/\-.][\p{L}\p{N}]+)*/gu) ?? [];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (VI_STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    kept.push(tok);
  }

  return kept.join(' or ');
}

/**
 * NER thô: trích các cụm 1-4 từ bắt đầu bằng chữ HOA (kể cả chữ có dấu tiếng
 * Việt). Không phải NER thật — chỉ đủ để đoán danh từ riêng cho fake provider
 * và cho việc thử map claim → thực thể (citation quan hệ).
 */
export function properNouns(text: string): string[] {
  const matches =
    text.match(/\p{Lu}[\p{L}]*(?:\s+\p{Lu}[\p{L}]*){0,3}/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const t = m.trim();
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
