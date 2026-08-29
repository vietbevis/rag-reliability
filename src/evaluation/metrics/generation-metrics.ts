/**
 * Số liệu chất lượng sinh câu trả lời (PROMPT §34) — phần baseline PHASE 4.
 * Hàm thuần; phần cần LLM-judge nằm ở {@link AnswerJudgeService}.
 *
 * Faithfulness / answer-relevance đầy đủ + hallucination detection theo layer
 * là việc của PHASE 9-10. Ở đây chỉ có:
 * - abstention accuracy (đúng lúc từ chối / đúng lúc trả lời)
 * - citation accuracy (lenient, mức document)
 * - hallucination rate **proxy** (đánh dấu rõ là ước lượng thô)
 */

export type AnswerStatus =
  | 'GROUNDED'
  | 'PARTIALLY_GROUNDED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTING_EVIDENCE'
  | 'ERROR';

export function isAbstained(status: AnswerStatus): boolean {
  return status === 'INSUFFICIENT_EVIDENCE';
}

/**
 * Case answerable → KHÔNG được abstain (và không lỗi).
 * Case unanswerable → PHẢI abstain.
 */
export function abstentionCorrect(
  answerable: boolean,
  status: AnswerStatus,
): boolean {
  return answerable
    ? status !== 'INSUFFICIENT_EVIDENCE' && status !== 'ERROR'
    : status === 'INSUFFICIENT_EVIDENCE';
}

export interface CitationLike {
  documentId: string;
}

/**
 * Tỉ lệ citation trỏ tới tài liệu gold (khớp mức document).
 * - Không có gold document → trả `null` (không đo được).
 * - Có gold nhưng không có citation nào → 0.
 */
export function citationAccuracy(
  citations: readonly CitationLike[],
  expectedDocumentIds: readonly string[],
): number | null {
  if (expectedDocumentIds.length === 0) return null;
  if (citations.length === 0) return 0;
  const gold = new Set(expectedDocumentIds);
  const hits = citations.filter((c) => gold.has(c.documentId)).length;
  return round(hits / citations.length);
}

export interface CaseOutcome {
  answerable: boolean;
  status: AnswerStatus;
  /** null nếu không chấm được (không có expectedAnswer / không có LLM judge). */
  answerCorrectness: number | null;
}

/**
 * Hallucination rate **PROXY** (PHASE 9 sẽ thay bằng claim-level): tỉ lệ case
 * answerable mà model KHÔNG abstain nhưng câu trả lời sai (correctness < 0.3),
 * cộng case unanswerable mà model bịa ra câu trả lời.
 */
export function hallucinationRateProxy(cases: readonly CaseOutcome[]): number {
  if (cases.length === 0) return 0;
  const bad = cases.filter((c) => {
    if (!c.answerable) return !isAbstained(c.status) && c.status !== 'ERROR';
    return (
      !isAbstained(c.status) &&
      c.answerCorrectness !== null &&
      c.answerCorrectness < 0.3
    );
  }).length;
  return round(bad / cases.length);
}

/** Trung bình bỏ qua null. */
export function meanIgnoringNull(
  values: readonly (number | null)[],
): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function meanBool(values: readonly boolean[]): number {
  if (values.length === 0) return 0;
  return round(values.filter(Boolean).length / values.length);
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
