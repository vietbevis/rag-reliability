/**
 * Numeric-provenance (agent-tools.md §9.3). Lexical match + NLI verifier hay
 * trượt khi số bị định dạng khác nhau ("684.500" vs "684,500" vs "684500") —
 * làm claim về số liệu ĐÃ tính/truy được bị đánh "không căn cứ" oan.
 *
 * Giải pháp thuần: trích mọi số "có nghĩa" (≥ 2 chữ số) trong câu trả lời và
 * đối chiếu (đã chuẩn hoá bỏ dấu phân cách) với số trong evidence.
 */

/** Chỉ tính số từ 2 chữ số trở lên — "1"/"5" quá nhiễu. */
const MIN_DIGITS = 2;
const NUMBER_RE = /\d[\d.,]*\d|\d{2,}/g;

/** Bỏ mọi ký tự không phải chữ số (dấu phân cách nghìn / thập phân / khoảng trắng). */
function digitsOnly(token: string): string {
  return token.replace(/[^\d]/g, '');
}

/**
 * Tập số (dạng chỉ-chữ-số, bỏ dấu phân cách) xuất hiện trong `text`. "684.500"
 * và "684500" cho cùng khoá "684500" — đây là điểm khớp §9.3 muốn. Đánh đổi:
 * số thập phân thật ("2.5") ≠ số nguyên ("25") vì bỏ dấu; chấp nhận được.
 */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) {
    const d = digitsOnly(m[0]);
    if (d.length >= MIN_DIGITS) out.add(d);
  }
  return out;
}

/**
 * true nếu `n` trông như một năm dương lịch trơ trọi (4 chữ số, 1900-2099).
 * Năm KHÔNG đặc trưng cho một claim cụ thể — nó lặp lại ở hầu hết mọi câu nói
 * về ngày tháng trong cùng ngữ cảnh (vd "hôm nay 4/9/2026" và "9/9/2026 là thứ
 * Ba" đều chứa "2026"). Numeric-provenance (§9.3) chỉ nên "chứng thực" một
 * claim khi ít nhất một số ĐẶC TRƯNG (giá tiền, cổng, id, số lượng…) trùng —
 * một mình năm trùng không đủ, kẻo claim sai (ngày/thứ khác) bị ép SUPPORTED
 * oan chỉ vì cùng năm với evidence không liên quan (agent-tools.md §9.3 [P1]).
 */
export function isGenericYear(n: string): boolean {
  return n.length === 4 && Number(n) >= 1900 && Number(n) <= 2099;
}

export interface NumericProvenance {
  /** Số "có nghĩa" tìm thấy trong câu trả lời. */
  checked: number;
  /** Số KHÔNG truy được về evidence. */
  ungrounded: string[];
  /** MỌI số trong answer đều có trong evidence (checked > 0). */
  allGrounded: boolean;
}

/**
 * Đối chiếu các số trong `answer` với `evidenceTexts` (nội dung chunk KB +
 * chunk computation giả). `checked = 0` ⇒ answer không có số ⇒ `allGrounded`
 * false (không kết luận gì).
 */
export function checkNumericProvenance(
  answer: string,
  evidenceTexts: readonly string[],
): NumericProvenance {
  const answerNums = extractNumbers(answer);
  if (answerNums.size === 0) {
    return { checked: 0, ungrounded: [], allGrounded: false };
  }
  const evidenceNums = new Set<string>();
  for (const t of evidenceTexts) {
    for (const n of extractNumbers(t)) evidenceNums.add(n);
  }
  const ungrounded = [...answerNums].filter((n) => !evidenceNums.has(n));
  return {
    checked: answerNums.size,
    ungrounded,
    allGrounded: ungrounded.length === 0,
  };
}

/** chunkId của các chunk chứa ít nhất một số của `claimText`. */
export function chunksBackingNumbers(
  claimText: string,
  chunks: readonly { chunkId: string; content: string }[],
): string[] {
  const claimNums = extractNumbers(claimText);
  if (claimNums.size === 0) return [];
  const out: string[] = [];
  for (const c of chunks) {
    const cn = extractNumbers(c.content);
    if ([...claimNums].some((n) => cn.has(n))) out.push(c.chunkId);
  }
  return out;
}
