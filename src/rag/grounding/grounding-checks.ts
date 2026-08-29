/**
 * Hàm THUẦN phát hiện câu trả lời không bám ngữ cảnh / là abstention trá hình
 * (PROMPT §23-25). Dùng bởi AnswerGenerationService để hậu kiểm — KHÔNG phải
 * faithfulness/claim-level (đó là PHASE 10).
 */
export type LlmAnswerStatus =
  | 'GROUNDED'
  | 'PARTIALLY_GROUNDED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTING_EVIDENCE';

/**
 * STRONG: cụm rõ ràng là "không trả lời được" — match dù answer dài (LLM chèn
 * một câu từ chối vào giữa câu trả lời cũng đủ để nghi ngờ).
 */
const STRONG_ABSTENTION: readonly string[] = [
  'không tìm thấy thông tin',
  'không đủ thông tin để trả lời',
  'không đủ căn cứ để trả lời',
  'không đủ bằng chứng để trả lời',
  'không thể trả lời câu hỏi',
  'tôi không biết',
  'insufficient_evidence',
  'insufficient evidence',
];

/**
 * WEAK: có thể là câu trả lời hợp lệ ("quy chế không đề cập thời hạn" là câu
 * trả lời ĐÚNG). Chỉ coi là abstention khi answer NGẮN (≤ ~25 từ) — câu trả lời
 * thực sự thường dài hơn và có thêm nội dung.
 */
const WEAK_ABSTENTION: readonly string[] = [
  'không tìm thấy',
  'không có thông tin',
  'không đủ thông tin',
  'không đủ căn cứ',
  'chưa có thông tin',
  'chưa đủ thông tin',
  'ngữ cảnh không đề cập',
  'ngữ cảnh không cung cấp',
  'tài liệu không đề cập',
  'tài liệu không cung cấp',
  'không tìm thấy thông tin đủ tin cậy',
];

const WEAK_ABSTENTION_MAX_WORDS = 25;

const VIETNAMESE_STOPWORDS: ReadonlySet<string> = new Set([
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
]);

function wordCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

/**
 * Kiểm tra xem câu trả lời có phải là từ chối trả lời (abstention) hay không.
 *
 * FINDING 1 (agy P8): `includes()` với chuỗi con quá chung ("không nêu rõ",
 * "không rõ"...) làm hỏng câu trả lời hợp lệ ("Quy chế không đề cập thời hạn"
 * LÀ câu trả lời đúng). Nay chia 2 tầng:
 *  - STRONG: cụm rõ nghĩa từ chối → match ở mọi độ dài.
 *  - WEAK: có thể là câu trả lời hợp lệ → chỉ match khi answer ngắn
 *    (≤ WEAK_ABSTENTION_MAX_WORDS từ), tức không có thêm nội dung thực chất.
 */
export function looksLikeAbstention(answer: string): boolean {
  if (!answer) {
    return true;
  }
  const normalized = answer.normalize('NFC').trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  if (STRONG_ABSTENTION.some((pattern) => normalized.includes(pattern))) {
    return true;
  }
  if (
    wordCount(normalized) <= WEAK_ABSTENTION_MAX_WORDS &&
    WEAK_ABSTENTION.some((pattern) => normalized.includes(pattern))
  ) {
    return true;
  }
  return false;
}

/**
 * Trích xuất tập các token nội dung (bỏ stopword và token < 2 ký tự).
 */
export function contentTokens(text: string): Set<string> {
  if (!text) {
    return new Set<string>();
  }
  const normalized = text.normalize('NFC').toLowerCase();
  const matches = normalized.match(/[\p{L}\p{N}]+/gu);
  if (!matches) {
    return new Set<string>();
  }

  const result = new Set<string>();
  for (const token of matches) {
    if (token.length >= 2 && !VIETNAMESE_STOPWORDS.has(token)) {
      result.add(token);
    }
  }
  return result;
}

/**
 * Tính tỷ lệ token nội dung của câu trả lời xuất hiện trong ngữ cảnh.
 * Trả về giá trị trong [0, 1] làm tròn 4 chữ số thập phân.
 */
export function lexicalGroundingRatio(
  answer: string,
  contextText: string,
): number {
  const a = contentTokens(answer);
  if (a.size === 0) {
    return 1;
  }
  const c = contentTokens(contextText);
  let intersectionCount = 0;
  for (const token of a) {
    if (c.has(token)) {
      intersectionCount++;
    }
  }
  const ratio = intersectionCount / a.size;
  return Math.round(ratio * 10000) / 10000;
}

export interface GroundingResolveInput {
  llmStatus: LlmAnswerStatus;
  answer: string;
  usedContextCount: number;
  groundedSelfReport: boolean; // LLM tự báo "mọi khẳng định đều có trong ngữ cảnh"
  lexicalRatio: number;
  minRatio: number; // ngưỡng RAG_MIN_GROUNDING_RATIO
  strict: boolean; // RAG_STRICT_GROUNDING
  answerTokenCount: number; // số token nội dung của answer (contentTokens(answer).size)
}

/**
 * FINDING 3 (agy P8): câu trả lời quá ngắn ("Hai học kỳ.") có a.size nhỏ nên
 * lexicalGroundingRatio nhiễu mạnh — bỏ qua rule (e) khi answer dưới ngưỡng này.
 */
const MIN_TOKENS_FOR_LEXICAL_CHECK = 5;

export interface GroundingResolveResult {
  status: LlmAnswerStatus;
  downgraded: boolean; // status khác llmStatus
  regenerate: boolean; // nên sinh lại 1 lần (chỉ strict)
  reason?: string;
}

/**
 * Quyết định status grounding cuối cùng dựa trên các tín hiệu và chế độ strict.
 */
export function resolveGroundingStatus(
  input: GroundingResolveInput,
): GroundingResolveResult {
  // a. looksLikeAbstention(answer) → status INSUFFICIENT_EVIDENCE, reason 'answer_is_abstention'
  if (looksLikeAbstention(input.answer)) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      downgraded: input.llmStatus !== 'INSUFFICIENT_EVIDENCE',
      regenerate: false,
      reason: 'answer_is_abstention',
    };
  }

  // b. llmStatus ∈ {GROUNDED, PARTIALLY_GROUNDED} và usedContextCount === 0 → INSUFFICIENT_EVIDENCE, reason 'grounded_but_no_citation'
  if (
    (input.llmStatus === 'GROUNDED' ||
      input.llmStatus === 'PARTIALLY_GROUNDED') &&
    input.usedContextCount === 0
  ) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      downgraded: true,
      regenerate: false,
      reason: 'grounded_but_no_citation',
    };
  }

  // c. llmStatus === CONFLICTING_EVIDENCE → giữ nguyên (không đụng)
  if (input.llmStatus === 'CONFLICTING_EVIDENCE') {
    return {
      status: 'CONFLICTING_EVIDENCE',
      downgraded: false,
      regenerate: false,
    };
  }

  // d. [strict] llmStatus === GROUNDED và groundedSelfReport === false → PARTIALLY_GROUNDED, reason 'llm_self_report_ungrounded'
  if (
    input.strict &&
    input.llmStatus === 'GROUNDED' &&
    !input.groundedSelfReport
  ) {
    return {
      status: 'PARTIALLY_GROUNDED',
      downgraded: true,
      regenerate: false,
      reason: 'llm_self_report_ungrounded',
    };
  }

  // e. [strict] llmStatus ∈ {GROUNDED, PARTIALLY_GROUNDED} và lexicalRatio < minRatio
  //    (chỉ khi answer đủ dài — answer ngắn cho ratio nhiễu, xem FINDING 3)
  if (
    input.strict &&
    input.answerTokenCount >= MIN_TOKENS_FOR_LEXICAL_CHECK &&
    (input.llmStatus === 'GROUNDED' ||
      input.llmStatus === 'PARTIALLY_GROUNDED') &&
    input.lexicalRatio < input.minRatio
  ) {
    return {
      status: 'PARTIALLY_GROUNDED',
      downgraded: input.llmStatus === 'GROUNDED',
      regenerate: true,
      reason: 'low_lexical_grounding',
    };
  }

  // f. mặc định: giữ llmStatus, downgraded=false, regenerate=false
  return {
    status: input.llmStatus,
    downgraded: false,
    regenerate: false,
  };
}
