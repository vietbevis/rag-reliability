import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EvaluationRunStatus } from '../generated/prisma/client';

/** Ngưỡng regression theo PROMPT §37. */
export const REGRESSION_THRESHOLDS = {
  /** recall@5 tụt quá 5 điểm phần trăm (tuyệt đối) so với baseline. */
  recallDropAbs: 0.05,
  /** hallucination rate tăng quá 3 điểm phần trăm so với baseline. */
  hallucinationRiseAbs: 0.03,
} as const;

export interface MetricDelta {
  metric: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
}

export interface BenchmarkComparison {
  runId: string;
  baselineRunId: string | null;
  datasetId: string;
  regressed: boolean;
  reasons: string[];
  deltas: MetricDelta[];
}

/**
 * So sánh một `EvaluationRun` với baseline gần nhất của cùng dataset (PROMPT
 * §35-37). Trả về delta từng số liệu và cờ `regressed` để CI chặn merge.
 */
@Injectable()
export class BenchmarkService {
  constructor(private readonly prisma: PrismaService) {}

  async compareToBaseline(runId: string): Promise<BenchmarkComparison> {
    const run = await this.prisma.evaluationRun.findUnique({
      where: { id: runId },
    });
    if (!run)
      throw new NotFoundException(`EvaluationRun ${runId} không tồn tại`);

    const baseline = await this.prisma.evaluationRun.findFirst({
      where: {
        datasetId: run.datasetId,
        isBaseline: true,
        status: EvaluationRunStatus.COMPLETED,
        id: { not: run.id },
      },
      orderBy: { createdAt: 'desc' },
    });

    const current = asMetricMap(run.metrics);
    const base = baseline ? asMetricMap(baseline.metrics) : {};

    const keys = [
      ...new Set([...Object.keys(base), ...Object.keys(current)]),
    ].sort();
    const deltas: MetricDelta[] = keys.map((metric) => {
      const b = numOrNull(base[metric]);
      const c = numOrNull(current[metric]);
      return {
        metric,
        baseline: b,
        current: c,
        delta: b !== null && c !== null ? round(c - b) : null,
      };
    });

    const reasons: string[] = [];
    if (baseline) {
      const recall = deltas.find((d) => d.metric === 'recallAt5');
      if (
        recall?.delta !== null &&
        recall?.delta !== undefined &&
        recall.delta < -REGRESSION_THRESHOLDS.recallDropAbs
      ) {
        reasons.push(
          `recallAt5 giảm ${(-recall.delta).toFixed(4)} (> ngưỡng ${REGRESSION_THRESHOLDS.recallDropAbs})`,
        );
      }
      const halluc = deltas.find((d) => d.metric === 'hallucinationRateProxy');
      if (
        halluc?.delta !== null &&
        halluc?.delta !== undefined &&
        halluc.delta > REGRESSION_THRESHOLDS.hallucinationRiseAbs
      ) {
        reasons.push(
          `hallucinationRateProxy tăng ${halluc.delta.toFixed(4)} (> ngưỡng ${REGRESSION_THRESHOLDS.hallucinationRiseAbs})`,
        );
      }
    }

    return {
      runId: run.id,
      baselineRunId: baseline?.id ?? null,
      datasetId: run.datasetId,
      regressed: reasons.length > 0,
      reasons,
      deltas,
    };
  }
}

function asMetricMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
