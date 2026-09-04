import type { BenchmarkReport } from './agent-benchmark.runner';
import { compareToBaseline, DEFAULT_THRESHOLDS } from './regression';

function report(
  over: Partial<BenchmarkReport['metrics']> = {},
): BenchmarkReport {
  return {
    createdAt: 'now',
    provider: 'fake',
    model: 'm',
    caseCount: 10,
    metrics: {
      taskSuccess: 0.95,
      avgScore: 0.9,
      toolSelectionAccuracy: 0.95,
      argumentAccuracy: 0.95,
      groundedness: 0.9,
      citationAccuracy: 0.85,
      hallucinationRate: 0.02,
      recoveryRate: 0.9,
      safetyRate: 1,
      avgSteps: 5,
      avgToolCalls: 2,
      avgLatencyMs: 100,
      totalTokens: 1000,
      ...over,
    },
    byCategory: {},
    byFailureClass: {},
    notMeasured: [],
    cases: [],
  };
}

describe('compareToBaseline', () => {
  it('report tốt, không baseline → không regression', () => {
    expect(compareToBaseline(report(), null).regressed).toBe(false);
  });

  it('taskSuccess dưới ngưỡng tuyệt đối → regressed', () => {
    const r = compareToBaseline(report({ taskSuccess: 0.6 }), null);
    expect(r.regressed).toBe(true);
    expect(r.reasons.join()).toMatch(/taskSuccess/);
  });

  it('hallucinationRate vượt ngưỡng → regressed', () => {
    expect(
      compareToBaseline(report({ hallucinationRate: 0.2 }), null).regressed,
    ).toBe(true);
  });

  it('tụt > maxAbsoluteDrop so baseline → regressed', () => {
    const base = report({ groundedness: 0.95 });
    const now = report({ groundedness: 0.8 });
    const r = compareToBaseline(now, base);
    expect(r.regressed).toBe(true);
    expect(r.reasons.join()).toMatch(/groundedness tụt/);
  });

  it('latency tăng > 1.5x baseline → regressed', () => {
    const base = report({ avgLatencyMs: 100 });
    const now = report({ avgLatencyMs: 200 });
    expect(compareToBaseline(now, base).regressed).toBe(true);
  });

  it('deltas gồm mọi metric', () => {
    const r = compareToBaseline(report(), report());
    expect(r.deltas.find((d) => d.metric === 'taskSuccess')?.delta).toBe(0);
  });

  it('bỏ qua metric trong notMeasured (chạy subset --case)', () => {
    const r = compareToBaseline(
      {
        ...report({ argumentAccuracy: 0, recoveryRate: 0 }),
        notMeasured: ['argumentAccuracy', 'recoveryRate'],
      },
      report(),
    );
    expect(r.reasons.join()).not.toMatch(/argumentAccuracy|recoveryRate/);
  });

  it('threshold config-able', () => {
    const r = compareToBaseline(report({ taskSuccess: 0.7 }), null, {
      ...DEFAULT_THRESHOLDS,
      minTaskSuccess: 0.6,
    });
    expect(r.regressed).toBe(false);
  });
});
