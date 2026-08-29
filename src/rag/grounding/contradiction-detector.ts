import { contentTokens } from './grounding-checks';

export interface ContradictionCheckResult {
  hasContradiction: boolean;
  reason?: string;
  contradictedChunkId?: string;
  conflictingChunkIds?: [string, string];
}

/**
 * Cặp từ phủ định / mâu thuẫn trực tiếp trong tiếng Việt.
 */
const NEGATION_PAIRS: Array<[string[], string[]]> = [
  [['không', 'chưa', 'chẳng', 'không được', 'cấm'], ['được', 'phải', 'bắt buộc', 'cho phép']],
  [['tăng', 'cao hơn', 'nhiều hơn'], ['giảm', 'thấp hơn', 'ít hơn']],
  [['tối đa', 'không quá'], ['tối thiểu', 'ít nhất']],
  [['hợp lệ', 'chấp nhận'], ['vô hiệu', 'không hợp lệ', 'từ chối', 'bị hủy']],
  [['miễn phí', 'không thu phí'], ['mất phí', 'thu phí', 'tính phí', 'đóng phí']],
  [['bắt buộc'], ['tùy chọn', 'khuyến khích', 'không bắt buộc', 'tự nguyện']],
];

/**
 * Trích xuất các số lượng / con số trong chuỗi văn bản kèm ngữ cảnh từ xung quanh.
 */
function extractNumbersWithContext(text: string): Map<string, string> {
  const norm = text.toLowerCase().normalize('NFC');
  const numberRegex = /(\b\d+(?:[.,]\d+)?\b|\b(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\b)\s+([a-zà-ỹ]+(?:\s+[a-zà-ỹ]+)?)/gi;
  const result = new Map<string, string>(); // unit/context -> number
  let match: RegExpExecArray | null;

  while ((match = numberRegex.exec(norm)) !== null) {
    const num = match[1]!;
    const context = match[2]!;
    result.set(context, num);
  }

  return result;
}

/**
 * Kiểm tra xem claim có mâu thuẫn phủ định hoặc mâu thuẫn số liệu trực tiếp với nội dung chunk hay không.
 */
export function detectClaimChunkContradiction(
  claimText: string,
  chunkContent: string,
): { contradicts: boolean; reason?: string } {
  const claimToks = contentTokens(claimText);
  const chunkToks = contentTokens(chunkContent);

  // Phải có độ phủ từ vựng ngữ cảnh cơ bản để xác định hai câu đang nói về cùng một chủ thể
  let shared = 0;
  for (const t of claimToks) {
    if (chunkToks.has(t)) shared++;
  }
  const contextOverlap = claimToks.size > 0 ? shared / claimToks.size : 0;
  if (contextOverlap < 0.3) {
    return { contradicts: false };
  }

  const claimLower = claimText.toLowerCase().normalize('NFC');
  const chunkLower = chunkContent.toLowerCase().normalize('NFC');

  // 1. Kiểm tra cặp phủ định / đối lập
  for (const [negatives, positives] of NEGATION_PAIRS) {
    const claimHasNeg = negatives.some((w) => claimLower.includes(w));
    const chunkHasPos = positives.some((w) => chunkLower.includes(w));
    const claimHasPos = positives.some((w) => claimLower.includes(w));
    const chunkHasNeg = negatives.some((w) => chunkLower.includes(w));

    if (claimHasNeg && chunkHasPos && !chunkHasNeg) {
      return {
        contradicts: true,
        reason: `Claim chứa từ phủ định (${negatives.join('/')}) trong khi chunk mang tính khẳng định`,
      };
    }
    if (claimHasPos && chunkHasNeg && !claimHasNeg) {
      return {
        contradicts: true,
        reason: `Claim mang tính khẳng định (${positives.join('/')}) trong khi chunk chứa từ phủ định`,
      };
    }
  }

  // 2. Kiểm tra mâu thuẫn con số theo cùng đơn vị / danh từ đi kèm
  const claimNums = extractNumbersWithContext(claimText);
  const chunkNums = extractNumbersWithContext(chunkContent);

  for (const [unit, claimNum] of claimNums) {
    const chunkNum = chunkNums.get(unit);
    if (chunkNum && chunkNum !== claimNum) {
      return {
        contradicts: true,
        reason: `Mâu thuẫn số liệu về "${unit}": claim nêu "${claimNum}" nhưng chunk nêu "${chunkNum}"`,
      };
    }
  }

  return { contradicts: false };
}

/**
 * Kiểm tra xem giữa các chunk ngữ cảnh có mâu thuẫn trực tiếp với nhau hay không (PROMPT §26).
 */
export function detectContextMutualContradiction(
  chunks: readonly { chunkId: string; content: string }[],
): { hasConflict: boolean; conflictingChunkIds?: [string, string]; reason?: string } {
  if (chunks.length < 2) {
    return { hasConflict: false };
  }

  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const c1 = chunks[i]!;
      const c2 = chunks[j]!;

      // So sánh số liệu cùng đơn vị
      const nums1 = extractNumbersWithContext(c1.content);
      const nums2 = extractNumbersWithContext(c2.content);

      for (const [unit, num1] of nums1) {
        const num2 = nums2.get(unit);
        if (num2 && num1 !== num2) {
          const toks1 = contentTokens(c1.content);
          const toks2 = contentTokens(c2.content);
          let common = 0;
          for (const t of toks1) {
            if (toks2.has(t)) common++;
          }
          if (common >= 3) {
            return {
              hasConflict: true,
              conflictingChunkIds: [c1.chunkId, c2.chunkId],
              reason: `Mâu thuẫn số liệu về "${unit}" giữa chunk ${c1.chunkId} (${num1}) và chunk ${c2.chunkId} (${num2})`,
            };
          }
        }
      }
    }
  }

  return { hasConflict: false };
}
