import type { ToolCall } from '../../../ai/llm/llm.interface';

/**
 * Khoá nhận dạng một lời gọi tool: tên + args đã chuẩn hoá (sort key, bỏ khoảng
 * trắng). Dùng để đếm số lần lặp lại đúng một lời gọi.
 */
export function toolCallKey(name: string, args: unknown): string {
  return `${name}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Ngưỡng Jaccard (trên tập từ của các giá trị chuỗi trong args) để coi hai lời
 * gọi CÙNG tool là "gần trùng" — vd model diễn đạt lại cùng một query search.
 */
const NEAR_DUPLICATE_JACCARD = 0.6;

/** Tập từ (chữ/số, chữ thường, NFC) của mọi giá trị chuỗi trong args. */
function argTokens(args: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const t of v
        .normalize('NFC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)) {
        if (t) out.add(t);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(args);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface LoopVerdict {
  /** `true` ⇒ KHÔNG thực thi tool này, trả lỗi tổng hợp cho model. */
  blocked: boolean;
  /** Số lần lời gọi này đã xuất hiện (kể cả lần hiện tại). */
  count: number;
}

/**
 * Quyết định có chặn một lời gọi tool vì lặp hay không. `priorCounts` là bản đồ
 * tích luỹ trong state (`toolInvocations`). `threshold` = số lần cho phép trước
 * khi chặn (đã có `threshold` lần trước đó ⇒ lần này bị chặn).
 *
 * Tính cả lời gọi GẦN TRÙNG của cùng tool (Jaccard tập từ ≥ ngưỡng), không chỉ
 * trùng khớp tuyệt đối — model hay diễn đạt lại cùng một query search thay vì
 * trả lời từ kết quả đã có.
 */
export function checkLoop(
  call: Pick<ToolCall, 'name' | 'args'>,
  priorCounts: Readonly<Record<string, number>>,
  threshold: number,
): LoopVerdict {
  const prefix = `${call.name}:`;
  const tokens = argTokens(call.args);
  const exactKey = toolCallKey(call.name, call.args);
  let prior = 0;
  for (const [key, n] of Object.entries(priorCounts)) {
    if (!key.startsWith(prefix)) continue;
    if (key === exactKey) {
      prior += n;
      continue;
    }
    let priorArgs: unknown;
    try {
      priorArgs = JSON.parse(key.slice(prefix.length));
    } catch {
      continue;
    }
    if (jaccard(tokens, argTokens(priorArgs)) >= NEAR_DUPLICATE_JACCARD) {
      prior += n;
    }
  }
  return { blocked: prior >= threshold, count: prior + 1 };
}
