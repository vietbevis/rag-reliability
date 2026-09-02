// promptfoo javascript assertion (PHASE 17.10): chấm trajectory bằng
// agent-metrics (dist/). Kỳ vọng lấy từ `test.metadata`, thực tế từ
// `providerResponse.metadata`.
import { scoreAgentCase } from '../../dist/evaluation/metrics/agent-metrics.js';

export default function assertTrajectory(output, context) {
  const exp = context.test?.metadata ?? {};
  const act = context.providerResponse?.metadata;
  if (!act) {
    return { pass: false, score: 0, reason: 'provider không trả metadata trajectory' };
  }

  const s = scoreAgentCase(
    {
      toolsUsed: act.toolsUsed ?? [],
      stepCount: act.stepCount ?? 0,
      toolCallCount: act.toolCallCount ?? 0,
      finalStatus: act.finalStatus ?? null,
      answer: output ?? null,
      formatValid: act.formatValid ?? 0,
      formatTotal: act.formatTotal ?? 0,
    },
    {
      expectedTools: exp.expectedTools,
      forbiddenTools: exp.forbiddenTools,
      mustAbstain: exp.mustAbstain,
      minSteps: exp.minSteps,
    },
  );

  return {
    pass: s.pass,
    score: s.score,
    reason: s.pass
      ? `trajectory OK (score ${s.score.toFixed(2)}, F1 ${s.components.toolF1.toFixed(2)})`
      : `trajectory FAIL: ${s.reasons.join('; ')}`,
  };
}
