/**
 * Kiểm tra `requiredFacts` / `forbiddenClaims` cấp câu trả lời (PROMPT §11-12).
 * Hàm THUẦN, TẤT ĐỊNH (không gọi LLM) — dùng bởi EvaluationService và
 * `scripts/validate-datasets.mjs`.
 *
 * Cách khớp (proxy thô, không thay LLM-judge / faithfulness — P10):
 * - `requiredFacts` (LENIENT): chuẩn hoá rồi so theo độ phủ token (≥
 *   `TOKEN_COVERAGE`) — chấp nhận diễn đạt lại, đảo trật tự.
 * - `forbiddenClaims` (STRICT): CHỈ khớp khi cụm chuẩn hoá xuất hiện gần như
 *   nguyên văn (substring, hoặc bỏ 1 stopword). Token-overlap gây dương tính
 *   giả nặng với câu phủ định: "KHÔNG được xét học bổng" chứa mọi token của
 *   "được xét học bổng". Forbidden claim là một CÁCH DIỄN ĐẠT cụ thể — người
 *   viết case chịu trách nhiệm chọn cụm đủ đặc trưng.
 */

const TOKEN_COVERAGE = 0.8;
const VI_STOPWORDS = new Set([
  'la',
  'thi',
  'va',
  'co',
  'duoc',
  'cua',
  'cho',
  'mot',
  'cac',
  'nhung',
]);

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // dấu tổ hợp (sau NFD)
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9%.,/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(s: string): string[] {
  return normalizeText(s)
    .split(/[\s.,/-]+/)
    .filter((t) => t.length >= 2);
}

/** LENIENT — `fact` coi như xuất hiện nếu ≥ 80% token nội dung có trong `answer`. */
export function factPresent(answer: string, fact: string): boolean {
  const norm = normalizeText(answer);
  const factNorm = normalizeText(fact);
  if (!factNorm) return true;
  if (norm.includes(factNorm)) return true;
  const toks = contentTokens(fact);
  if (toks.length === 0) return true;
  const hit = toks.filter((t) => norm.includes(t)).length;
  return hit / toks.length >= TOKEN_COVERAGE;
}

/**
 * STRICT — `claim` coi như LỘ ra chỉ khi cụm chuẩn hoá xuất hiện gần nguyên văn:
 * substring trực tiếp, hoặc chuỗi token (đã bỏ stopword) xuất hiện liên tiếp.
 * Không dùng độ phủ token rời rạc → không dính câu phủ định.
 */
export function claimLeaked(answer: string, claim: string): boolean {
  const norm = normalizeText(answer);
  const claimNorm = normalizeText(claim);
  if (!claimNorm) return false;
  if (norm.includes(claimNorm)) return true;
  const keep = claimNorm
    .split(/[\s.,/-]+/)
    .filter((t) => t.length >= 2 && !VI_STOPWORDS.has(t));
  if (keep.length === 0) return false;
  // chuỗi các token đặc trưng, cho phép tối đa 2 từ chèn giữa mỗi cặp
  const re = new RegExp(
    keep
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('(?:\\s+\\S+){0,2}\\s+'),
  );
  return re.test(norm);
}

/**
 * Tỉ lệ `requiredFacts` xuất hiện trong câu trả lời. `[]` → null (không đo được).
 * `answer` null/rỗng → 0.
 */
export function requiredFactRecall(
  answer: string | null,
  requiredFacts: readonly string[],
): number | null {
  if (requiredFacts.length === 0) return null;
  if (!answer) return 0;
  const hit = requiredFacts.filter((f) => factPresent(answer, f)).length;
  return round(hit / requiredFacts.length);
}

/**
 * Tỉ lệ `forbiddenClaims` LỘ ra trong câu trả lời (cao = xấu). `[]` → null.
 * `answer` null/rỗng → 0 (không lộ gì).
 */
export function forbiddenClaimRate(
  answer: string | null,
  forbiddenClaims: readonly string[],
): number | null {
  if (forbiddenClaims.length === 0) return null;
  if (!answer) return 0;
  const leaked = forbiddenClaims.filter((f) => claimLeaked(answer, f)).length;
  return round(leaked / forbiddenClaims.length);
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
