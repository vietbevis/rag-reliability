/**
 * Số liệu đánh giá agent (PHASE 17.10). Hàm thuần, không phụ thuộc Nest — dùng
 * bởi promptfoo assertion (`evaluation/agent/`) và regression gate.
 *
 * Bổ sung cho những gì promptfoo có sẵn (contains / llm-rubric / latency /
 * cost): chọn tool, hiệu quả bước, abstention, format-validity.
 */

export interface AgentTrajectory {
  /** Tên tool đã gọi, theo thứ tự (có thể trùng). */
  toolsUsed: readonly string[];
  stepCount: number;
  toolCallCount: number;
  /** `GROUNDED` | `PARTIALLY_GROUNDED` | `INSUFFICIENT_EVIDENCE` | `CONFLICTING_EVIDENCE` | null */
  finalStatus: string | null;
  answer: string | null;
  /** Số tool call model sinh có args hợp lệ theo schema. */
  formatValid: number;
  /** Tổng số tool call model sinh. */
  formatTotal: number;
}

export interface AgentExpectation {
  /** Tool NÊN được dùng (tập, không xét thứ tự). */
  expectedTools?: readonly string[];
  /** Tool KHÔNG được dùng. */
  forbiddenTools?: readonly string[];
  /** Case này agent phải abstain (`INSUFFICIENT_EVIDENCE`). */
  mustAbstain?: boolean;
  /** Số bước tối thiểu hợp lý để giải (cho step-efficiency). */
  minSteps?: number;
}

export interface PRF {
  precision: number;
  recall: number;
  f1: number;
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

/**
 * Precision/Recall/F1 của tập tool đã dùng so với `expected`. `expected` rỗng →
 * precision = 1 nếu không dùng tool nào, ngược lại 0 (dùng tool thừa).
 */
export function toolSelection(
  used: readonly string[],
  expected: readonly string[],
): PRF {
  const u = new Set(uniq(used));
  const e = new Set(uniq(expected));
  if (e.size === 0) {
    const precision = u.size === 0 ? 1 : 0;
    return { precision, recall: 1, f1: precision === 1 ? 1 : 0 };
  }
  if (u.size === 0) return { precision: 1, recall: 0, f1: 0 };

  let tp = 0;
  for (const t of u) if (e.has(t)) tp++;
  const precision = tp / u.size;
  const recall = tp / e.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** 1 nếu KHÔNG gọi tool cấm nào, 0 nếu có. */
export function forbiddenToolCompliance(
  used: readonly string[],
  forbidden: readonly string[] = [],
): number {
  const f = new Set(forbidden);
  return used.some((t) => f.has(t)) ? 0 : 1;
}

/** 1 nếu abstention khớp kỳ vọng (`mustAbstain` ↔ finalStatus INSUFFICIENT_EVIDENCE). */
export function abstentionCorrect(
  finalStatus: string | null,
  mustAbstain = false,
): number {
  const abstained = finalStatus === 'INSUFFICIENT_EVIDENCE';
  return abstained === mustAbstain ? 1 : 0;
}

/** `minSteps / actualSteps` clamp [0,1]. 1 = không thừa bước; thiếu `minSteps` → 1. */
export function stepEfficiency(actualSteps: number, minSteps?: number): number {
  if (!minSteps || minSteps <= 0 || actualSteps <= 0) return 1;
  return Math.min(1, minSteps / actualSteps);
}

/** % tool call có format args hợp lệ. Không có tool call nào → 1. */
export function formatValidity(valid: number, total: number): number {
  return total <= 0 ? 1 : valid / total;
}

export interface AgentCaseScore {
  pass: boolean;
  /** Điểm tổng hợp [0,1] (trung bình có trọng số). */
  score: number;
  components: {
    toolF1: number;
    forbiddenCompliance: number;
    abstention: number;
    stepEfficiency: number;
    formatValidity: number;
  };
  reasons: string[];
}

/**
 * Chấm một case. `pass` = mọi ràng buộc CỨNG thoả: không gọi tool cấm,
 * abstention đúng, format-validity ≥ 0.8. `score` gộp thêm tool-F1 + efficiency.
 */
export function scoreAgentCase(
  traj: AgentTrajectory,
  exp: AgentExpectation,
): AgentCaseScore {
  const toolF1 = toolSelection(traj.toolsUsed, exp.expectedTools ?? []).f1;
  const forbiddenCompliance = forbiddenToolCompliance(
    traj.toolsUsed,
    exp.forbiddenTools,
  );
  const abstention = abstentionCorrect(traj.finalStatus, exp.mustAbstain);
  const efficiency = stepEfficiency(traj.stepCount, exp.minSteps);
  const fmt = formatValidity(traj.formatValid, traj.formatTotal);

  const reasons: string[] = [];
  if (forbiddenCompliance === 0) reasons.push('gọi tool bị cấm');
  if (abstention === 0) {
    reasons.push(
      exp.mustAbstain ? 'đáng lẽ phải abstain' : 'abstain không đúng lúc',
    );
  }
  if (fmt < 0.8) reasons.push(`format-validity thấp (${fmt.toFixed(2)})`);
  if (toolF1 < 0.5 && (exp.expectedTools?.length ?? 0) > 0) {
    reasons.push(`tool-selection F1 thấp (${toolF1.toFixed(2)})`);
  }

  const pass = forbiddenCompliance === 1 && abstention === 1 && fmt >= 0.8;
  const score =
    0.35 * toolF1 +
    0.2 * abstention +
    0.15 * forbiddenCompliance +
    0.15 * efficiency +
    0.15 * fmt;

  return {
    pass,
    score,
    components: {
      toolF1,
      forbiddenCompliance,
      abstention,
      stepEfficiency: efficiency,
      formatValidity: fmt,
    },
    reasons,
  };
}
