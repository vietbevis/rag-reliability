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
 * Cụm "chỉ đường": câu trả lời né nội dung, chỉ TRỎ người đọc tới vị trí thông
 * tin ("được nêu tại Mục [2]", "xem Bảng 3") thay vì trích chính nội dung đó
 * (SYSTEM_PROMPT §B). Mỗi cụm phải kèm danh từ cấu trúc (mục/bảng/phần...) —
 * trích dẫn điều/khoản luật rời ("theo Điều 25") KHÔNG tính, đó là dẫn nguồn hợp lệ.
 */
const POINTER_PHRASES: readonly string[] = [
  'được quy định tại',
  'được quy định ở',
  'được quy định trong',
  'được nêu tại',
  'được nêu ở',
  'được nêu trong',
  'được nêu rõ tại',
  'được nêu cụ thể tại',
  'được trình bày tại',
  'được trình bày ở',
  'được trình bày trong',
  'được cung cấp tại',
  'được cung cấp ở',
  'được cung cấp trong',
  'được liệt kê tại',
  'được liệt kê ở',
  'được liệt kê trong',
  'được thể hiện tại',
  'được thể hiện trong',
  'được đề cập tại',
  'được đề cập trong',
  'được ghi tại',
  'được ghi rõ tại',
  'được ghi trong',
  'xem mục',
  'xem bảng',
  'xem phần',
  'xem chi tiết tại',
  'xem chi tiết ở',
  'xem thêm tại',
  'xem tại mục',
  'xem ở mục',
  'tham khảo mục',
  'tham khảo bảng',
  'tham khảo phần',
  'tham khảo tại mục',
  'tham khảo tại bảng',
  'chi tiết xem',
  'chi tiết tại mục',
  'chi tiết tại bảng',
  'chi tiết ở mục',
  'chi tiết trong mục',
  'chi tiết trong bảng',
  'nêu tại mục',
  'nêu ở mục',
  'nêu trong mục',
  'nêu tại bảng',
  'nêu trong bảng',
  'trình bày tại mục',
  'trình bày ở mục',
  'trình bày trong bảng',
  'nằm ở mục',
  'nằm trong mục',
  'nằm tại mục',
  'có tại mục',
  'có trong mục',
  'có ở mục',
  'thông tin tại mục',
  'thông tin ở mục',
  'thông tin trong mục',
  'theo nội dung mục',
  'dựa trên mục',
];

/** Trỏ trực tiếp bằng số thứ tự chunk: "xem [2]", "tại [3] có nêu"... */
const POINTER_INDEX_PATTERNS: readonly RegExp[] = [
  /\b(xem|tại|ở|trong|theo)\s*\[\d+\]/u,
  /\[\d+\]\s*(có nêu|có ghi|cung cấp|nêu rõ|trình bày|liệt kê|chứa|đề cập)/u,
];

const POINTER_MAX_WORDS = 45;

/**
 * Số liệu "nội dung" — bỏ qua số thứ tự cấu trúc ("Bảng 3", "Mục [2]", "Điều
 * 15"): số đó là một phần của việc CHỈ ĐƯỜNG, không phải dữ liệu trả lời.
 */
function hasContentDigit(normalized: string): boolean {
  const stripped = normalized
    .replace(/\[\d+\]/g, ' ')
    .replace(
      /\b(mục|bảng|biểu|biểu mẫu|phụ lục|điều|khoản|điểm|phần|chương)\s+\d+/gu,
      ' ',
    );
  return /\d/.test(stripped);
}

/**
 * Câu trả lời kiểu "chỉ đường" (SYSTEM_PROMPT §B): chỉ trỏ vị trí thông tin chứ
 * không trích nội dung. Chỉ nhận diện khi cả ba điều kiện đúng, để không phạt
 * oan câu trả lời thực có kèm dẫn nguồn:
 *  - answer NGẮN (≤ POINTER_MAX_WORDS từ),
 *  - KHÔNG có số liệu nội dung (câu trả lời thực về bảng/mức/tỷ lệ luôn có số),
 *  - có cụm trỏ vị trí kèm danh từ cấu trúc, hoặc trỏ thẳng số chunk `[i]`.
 */
export function looksLikePointerAnswer(answer: string): boolean {
  if (!answer) {
    return false;
  }
  const normalized = answer.normalize('NFC').trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (wordCount(normalized) > POINTER_MAX_WORDS) {
    return false;
  }
  if (hasContentDigit(normalized)) {
    return false;
  }
  if (POINTER_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  return POINTER_INDEX_PATTERNS.some((re) => re.test(normalized));
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

  // c2. [strict] câu trả lời kiểu "chỉ đường" (trỏ vị trí thay vì trích nội dung)
  //     → PARTIALLY_GROUNDED + sinh lại 1 lần với chỉ dẫn riêng (reason 'pointer_answer').
  if (
    input.strict &&
    (input.llmStatus === 'GROUNDED' ||
      input.llmStatus === 'PARTIALLY_GROUNDED') &&
    looksLikePointerAnswer(input.answer)
  ) {
    return {
      status: 'PARTIALLY_GROUNDED',
      downgraded: input.llmStatus === 'GROUNDED',
      regenerate: true,
      reason: 'pointer_answer',
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
