/**
 * Tiện ích văn bản dùng chung (không phụ thuộc domain).
 */

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
