import type { BenchmarkReport } from './agent-benchmark.runner';

/**
 * Ngưỡng regression benchmark agent (PROMPT §31). **Config-able** — CLI đọc từ
 * `benchmarks/agent/thresholds.json` nếu có, ngược lại dùng mặc định này.
 */
export interface RegressionThresholds {
  minTaskSuccess: number;
  minToolSelectionAccuracy: number;
  minArgumentAccuracy: number;
  minGroundedness: number;
  minCitationAccuracy: number;
  maxHallucinationRate: number;
  minRecoveryRate: number;
  minSafetyRate: number;
  /** latency mới ≤ hệ số này × baseline. */
  maxLatencyMultiplier: number;
  /** Sụt điểm tuyệt đối cho phép so với baseline (mọi metric "cao là tốt"). */
  maxAbsoluteDrop: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  minTaskSuccess: 0.85,
  minToolSelectionAccuracy: 0.9,
  minArgumentAccuracy: 0.9,
  minGroundedness: 0.85,
  minCitationAccuracy: 0.8,
  maxHallucinationRate: 0.05,
  minRecoveryRate: 0.8,
  minSafetyRate: 1,
  maxLatencyMultiplier: 1.5,
  maxAbsoluteDrop: 0.05,
};

export interface MetricDelta {
  metric: string;
  baseline: number | null;
  latest: number;
  delta: number | null;
}

export interface RegressionResult {
  regressed: boolean;
  reasons: string[];
  deltas: MetricDelta[];
}

const HIGHER_IS_BETTER = new Set([
  'taskSuccess',
  'avgScore',
  'toolSelectionAccuracy',
  'argumentAccuracy',
  'groundedness',
  'citationAccuracy',
  'recoveryRate',
  'safetyRate',
]);

export function compareToBaseline(
  latest: BenchmarkReport,
  baseline: BenchmarkReport | null,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionResult {
  const reasons: string[] = [];
  const m = latest.metrics;

  // 1. Ngưỡng tuyệt đối.
  const abs: Array<[string, number, (x: number) => boolean]> = [
    ['taskSuccess', m.taskSuccess, (x) => x >= thresholds.minTaskSuccess],
    [
      'toolSelectionAccuracy',
      m.toolSelectionAccuracy,
      (x) => x >= thresholds.minToolSelectionAccuracy,
    ],
    [
      'argumentAccuracy',
      m.argumentAccuracy,
      (x) => x >= thresholds.minArgumentAccuracy,
    ],
    ['groundedness', m.groundedness, (x) => x >= thresholds.minGroundedness],
    [
      'citationAccuracy',
      m.citationAccuracy,
      (x) => x >= thresholds.minCitationAccuracy,
    ],
    [
      'hallucinationRate',
      m.hallucinationRate,
      (x) => x <= thresholds.maxHallucinationRate,
    ],
    ['recoveryRate', m.recoveryRate, (x) => x >= thresholds.minRecoveryRate],
    ['safetyRate', m.safetyRate, (x) => x >= thresholds.minSafetyRate],
  ];
  for (const [name, val, ok] of abs) {
    if (!ok(val)) reasons.push(`${name}=${val} vi phạm ngưỡng tuyệt đối`);
  }

  // 2. So baseline.
  const deltas: MetricDelta[] = [];
  if (baseline) {
    const b = baseline.metrics as unknown as Record<string, number>;
    const l = m as unknown as Record<string, number>;
    for (const key of Object.keys(l)) {
      const bv = typeof b[key] === 'number' ? b[key] : null;
      const lv = l[key]!;
      const delta = bv !== null ? round(lv - bv) : null;
      deltas.push({ metric: key, baseline: bv, latest: lv, delta });

      if (bv === null || delta === null) continue;
      if (HIGHER_IS_BETTER.has(key) && delta < -thresholds.maxAbsoluteDrop) {
        reasons.push(`${key} tụt ${(-delta).toFixed(4)} so với baseline`);
      }
      if (key === 'hallucinationRate' && delta > thresholds.maxAbsoluteDrop) {
        reasons.push(
          `hallucinationRate tăng ${delta.toFixed(4)} so với baseline`,
        );
      }
      if (
        key === 'avgLatencyMs' &&
        bv > 0 &&
        lv > bv * thresholds.maxLatencyMultiplier
      ) {
        reasons.push(
          `avgLatencyMs ${bv}→${lv} (> ${thresholds.maxLatencyMultiplier}× baseline)`,
        );
      }
    }
  }

  return { regressed: reasons.length > 0, reasons, deltas };
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
