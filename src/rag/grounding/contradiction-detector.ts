import { contentTokens } from './grounding-checks';

export interface ContradictionCheckResult {
  hasContradiction: boolean;
  reason?: string;
  contradictedChunkId?: string;
  conflictingChunkIds?: [string, string];
}

/**
 * Cặp cụm từ đối lập trực tiếp trong tiếng Việt (dạng cụm, KHÔNG dùng từ đơn
 * như "được"/"phải" vì chúng xuất hiện dày đặc trong văn phong hành chính và
 * gây dương tính giả — xem docs/audit/FAITHFULNESS_REVIEW.md §3 [P0]).
 *
 * Quy ước mỗi cặp: `[negatives, positives]`. Cụm phủ định được so khớp TRƯỚC và
 * loại khỏi chuỗi (xem {@link polarity}) nên "không được phép" tính là phủ định
 * chứ không lẫn sang "được phép".
 */
const NEGATION_PAIRS: Array<[string[], string[]]> = [
  [
    [
      'không được phép',
      'không được',
      'không cho phép',
      'không được quyền',
      'bị cấm',
      'nghiêm cấm',
      'cấm ',
    ],
    ['được phép', 'cho phép', 'được quyền', 'có quyền'],
  ],
  [
    ['tăng lên', 'cao hơn', 'nhiều hơn', 'gia tăng'],
    ['giảm xuống', 'thấp hơn', 'ít hơn', 'cắt giảm'],
  ],
  [
    ['hợp lệ', 'được chấp nhận'],
    ['vô hiệu', 'không hợp lệ', 'bị từ chối', 'bị hủy', 'không được chấp nhận'],
  ],
  [
    ['miễn phí', 'không thu phí', 'không mất phí'],
    ['có thu phí', 'phải đóng phí', 'phải nộp lệ phí'],
  ],
  [
    ['bắt buộc', 'là điều kiện bắt buộc'],
    ['không bắt buộc', 'tự nguyện', 'tùy chọn', 'không yêu cầu'],
  ],
];

type Polarity = 'neg' | 'pos' | 'both' | 'none';

/**
 * Xác định cực (phủ định / khẳng định) của một chuỗi đối với MỘT cặp đối lập.
 * Cụm phủ định được loại bỏ khỏi chuỗi trước khi dò cụm khẳng định để tránh
 * "không được phép" bị tính nhầm thành khẳng định do chứa chuỗi con "được phép".
 */
function polarity(
  textLower: string,
  negatives: string[],
  positives: string[],
): Polarity {
  let stripped = textLower;
  let hasNeg = false;
  for (const n of negatives) {
    if (stripped.includes(n)) {
      hasNeg = true;
      stripped = stripped.split(n).join(' ');
    }
  }
  const hasPos = positives.some((p) => stripped.includes(p));
  if (hasNeg && hasPos) return 'both';
  if (hasNeg) return 'neg';
  if (hasPos) return 'pos';
  return 'none';
}

const VN_NUMBER_WORDS: Record<string, number> = {
  một: 1,
  hai: 2,
  ba: 3,
  bốn: 4,
  năm: 5,
  sáu: 6,
  bảy: 7,
  tám: 8,
  chín: 9,
  mười: 10,
  'mười lăm': 15,
  'hai mươi': 20,
  'ba mươi': 30,
};

/** Chuẩn hoá token số (chữ hoặc số) về giá trị number, hoặc null nếu không phải số. */
function parseNumber(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return VN_NUMBER_WORDS[t] ?? null;
}

/**
 * Trích các con số kèm CỤM ĐƠN VỊ 2 từ đứng sau (vd "học kỳ", "tín chỉ",
 * "phần trăm"). Chỉ giữ cụm 2 từ để giảm va chạm ngẫu nhiên (bare "ngày",
 * "tuần" xuất hiện với đủ loại con số ở các điều khoản không liên quan).
 * Trả `Map<đơn_vị_2_từ, Set<number>>`.
 */
function extractNumbersWithContext(text: string): Map<string, Set<number>> {
  const norm = text.toLowerCase().normalize('NFC');
  const numberRegex =
    /(\d+(?:[.,]\d+)?|(?:mười lăm|hai mươi|ba mươi|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười))\s+([a-zà-ỹ]+\s+[a-zà-ỹ]+)/gi;
  const result = new Map<string, Set<number>>();
  let match: RegExpExecArray | null;

  while ((match = numberRegex.exec(norm)) !== null) {
    const value = parseNumber(match[1]!);
    if (value === null) continue;
    const unit = match[2]!.trim();
    if (!result.has(unit)) result.set(unit, new Set());
    result.get(unit)!.add(value);
  }

  return result;
}

/** Độ tương đồng Jaccard giữa hai tập token nội dung. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
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

  // 1. Kiểm tra cặp phủ định / đối lập.
  //    CHỈ báo mâu thuẫn khi hai bên có cực RÕ RÀNG và NGƯỢC nhau. Nếu một bên
  //    chứa cả hai cực ('both' — vd chunk gộp Điều 1 "được phép bảo lưu" và
  //    Điều 3 "không được dự thi") thì bỏ qua để tránh dương tính giả.
  for (const [negatives, positives] of NEGATION_PAIRS) {
    const claimPol = polarity(claimLower, negatives, positives);
    const chunkPol = polarity(chunkLower, negatives, positives);

    if (claimPol === 'neg' && chunkPol === 'pos') {
      return {
        contradicts: true,
        reason: `Claim chứa từ phủ định (${negatives[0]}) trong khi chunk mang tính khẳng định (${positives[0]})`,
      };
    }
    if (claimPol === 'pos' && chunkPol === 'neg') {
      return {
        contradicts: true,
        reason: `Claim mang tính khẳng định (${positives[0]}) trong khi chunk chứa từ phủ định (${negatives[0]})`,
      };
    }
  }

  // 2. Kiểm tra mâu thuẫn con số theo cùng CỤM ĐƠN VỊ 2 từ. Chỉ báo khi claim
  //    và chunk nêu con số KHÁC nhau cho cùng đơn vị và KHÔNG có giá trị chung
  //    (chunk liệt kê nhiều mốc "2,0 / 2,5 / 3,2" không mâu thuẫn với claim nêu
  //    một trong số đó).
  const claimNums = extractNumbersWithContext(claimText);
  const chunkNums = extractNumbersWithContext(chunkContent);

  for (const [unit, claimVals] of claimNums) {
    const chunkVals = chunkNums.get(unit);
    if (!chunkVals) continue;
    const shareValue = [...claimVals].some((v) => chunkVals.has(v));
    if (!shareValue) {
      return {
        contradicts: true,
        reason: `Mâu thuẫn số liệu về "${unit}": claim nêu {${[...claimVals].join(',')}} nhưng chunk nêu {${[...chunkVals].join(',')}}`,
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
): {
  hasConflict: boolean;
  conflictingChunkIds?: [string, string];
  reason?: string;
} {
  if (chunks.length < 2) {
    return { hasConflict: false };
  }

  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const c1 = chunks[i]!;
      const c2 = chunks[j]!;

      // Hai chunk phải cùng CHỦ ĐỀ mới đáng nghi mâu thuẫn. Jaccard token nội
      // dung >= 0.4 chặt hơn nhiều so với "chung >= 3 token" (mọi điều khoản quy
      // chế đều chung "sinh viên", "học", "quy định"...).
      const toks1 = contentTokens(c1.content);
      const toks2 = contentTokens(c2.content);
      if (jaccard(toks1, toks2) < 0.4) continue;

      const nums1 = extractNumbersWithContext(c1.content);
      const nums2 = extractNumbersWithContext(c2.content);

      for (const [unit, vals1] of nums1) {
        const vals2 = nums2.get(unit);
        if (!vals2) continue;
        const shareValue = [...vals1].some((v) => vals2.has(v));
        if (!shareValue) {
          return {
            hasConflict: true,
            conflictingChunkIds: [c1.chunkId, c2.chunkId],
            reason: `Mâu thuẫn số liệu về "${unit}" giữa chunk ${c1.chunkId} {${[...vals1].join(',')}} và chunk ${c2.chunkId} {${[...vals2].join(',')}}`,
          };
        }
      }
    }
  }

  return { hasConflict: false };
}
