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
 */
export function checkLoop(
  call: Pick<ToolCall, 'name' | 'args'>,
  priorCounts: Readonly<Record<string, number>>,
  threshold: number,
): LoopVerdict {
  const key = toolCallKey(call.name, call.args);
  const prior = priorCounts[key] ?? 0;
  return { blocked: prior >= threshold, count: prior + 1 };
}
