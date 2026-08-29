import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EvaluationRunStatus } from '../generated/prisma/client';

/** Ngưỡng regression theo PROMPT §37. */
export const REGRESSION_THRESHOLDS = {
  /** recall@5 tụt quá 5 điểm phần trăm (tuyệt đối) so với baseline. */
  recallDropAbs: 0.05,
  /** hallucination rate tăng quá 3 điểm phần trăm so với baseline. */
  hallucinationRiseAbs: 0.03,
  /** faithfulness tụt quá 5 điểm phần trăm so với baseline. */
  faithfulnessDropAbs: 0.05,
  /** context precision tụt quá 5 điểm phần trăm so với baseline. */
  contextPrecisionDropAbs: 0.05,
  /** latency tăng quá 50% so với baseline. */
  latencyMultiplier: 1.5,
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

  /**
   * Đặt một EvaluationRun làm baseline chính thức của dataset.
   */
  async setBaseline(runId: string): Promise<{ runId: string; datasetId: string; isBaseline: boolean }> {
    const run = await this.prisma.evaluationRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException(`EvaluationRun ${runId} không tồn tại`);
    }

    // Huỷ cờ baseline của các run cũ cùng dataset
    await this.prisma.evaluationRun.updateMany({
      where: { datasetId: run.datasetId, isBaseline: true },
      data: { isBaseline: false },
    });

    // Bật baseline cho run được chỉ định
    await this.prisma.evaluationRun.update({
      where: { id: runId },
      data: { isBaseline: true },
    });

    return {
      runId,
      datasetId: run.datasetId,
      isBaseline: true,
    };
  }

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
      // 1. Kiểm tra Recall@5
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

      // 2. Kiểm tra Hallucination Rate
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

      // 3. Kiểm tra Faithfulness
      const faith = deltas.find((d) => d.metric === 'faithfulness');
      if (
        faith?.delta !== null &&
        faith?.delta !== undefined &&
        faith.delta < -REGRESSION_THRESHOLDS.faithfulnessDropAbs
      ) {
        reasons.push(
          `faithfulness giảm ${(-faith.delta).toFixed(4)} (> ngưỡng ${REGRESSION_THRESHOLDS.faithfulnessDropAbs})`,
        );
      }

      // 4. Kiểm tra Context Precision
      const ctxPrec = deltas.find((d) => d.metric === 'contextPrecision');
      if (
        ctxPrec?.delta !== null &&
        ctxPrec?.delta !== undefined &&
        ctxPrec.delta < -REGRESSION_THRESHOLDS.contextPrecisionDropAbs
      ) {
        reasons.push(
          `contextPrecision giảm ${(-ctxPrec.delta).toFixed(4)} (> ngưỡng ${REGRESSION_THRESHOLDS.contextPrecisionDropAbs})`,
        );
      }

      // 5. Kiểm tra Latency Spike (> 1.5x)
      const lat = deltas.find((d) => d.metric === 'avgLatencyMs');
      if (
        lat?.baseline &&
        lat?.current &&
        lat.current > lat.baseline * REGRESSION_THRESHOLDS.latencyMultiplier
      ) {
        reasons.push(
          `avgLatencyMs tăng từ ${lat.baseline}ms lên ${lat.current}ms (> ${(REGRESSION_THRESHOLDS.latencyMultiplier * 100).toFixed(0)}% baseline)`,
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
