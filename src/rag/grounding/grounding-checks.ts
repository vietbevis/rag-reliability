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

const ABSTENTION_PATTERNS: readonly string[] = [
  'không tìm thấy',
  'không có thông tin',
  'không đủ thông tin',
  'không đủ căn cứ',
  'không đủ cơ sở',
  'không đủ tài liệu',
  'không đủ bằng chứng',
  'không thể trả lời',
  'tôi không biết',
  'chưa có thông tin',
  'chưa có dữ liệu',
  'chưa đủ thông tin',
  'chưa đủ căn cứ',
  'chưa đủ cơ sở',
  'ngữ cảnh không đề cập',
  'ngữ cảnh không có',
  'ngữ cảnh không cung cấp',
  'tài liệu không đề cập',
  'tài liệu không có',
  'tài liệu không cung cấp',
  'tài liệu không nhắc',
  'không được đề cập',
  'không được nhắc đến',
  'không được nhắc tới',
  'không được nêu',
  'không được cung cấp',
  'không nêu rõ',
  'không rõ',
  'không xác định được',
  'không thể xác định',
  'không có dữ liệu',
  'không có tài liệu',
  'không có cơ sở',
  'không có căn cứ',
  'insufficient_evidence',
  'insufficient evidence',
];

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
]);

/**
 * Kiểm tra xem câu trả lời có khớp các mẫu từ chối trả lời (abstention) hay không.
 */
export function looksLikeAbstention(answer: string): boolean {
  if (!answer) {
    return true;
  }
  const normalized = answer.normalize('NFC').trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return ABSTENTION_PATTERNS.some((pattern) => normalized.includes(pattern));
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
}

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
  if (
    input.strict &&
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
