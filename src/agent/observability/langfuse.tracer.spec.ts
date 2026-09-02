import { mockConfigService } from '../../config/config.mock';
import type { AgentRunOutcome } from '../graph/agent-graph.builder';
import type { AgentRunResult } from '../agent.service';
import { LangfuseTracer } from './langfuse.tracer';

const result: AgentRunResult = {
  id: 'run-1',
  task: 'câu hỏi',
  status: 'COMPLETED',
  finalStatus: 'GROUNDED',
  stopReason: 'final',
  answer: 'đáp án',
  citations: [],
  claims: [],
  faithfulness: null,
  usage: { inputTokens: 1, outputTokens: 2, estimatedCost: 0 },
  toolCallCount: 0,
  toolsUsed: [],
  toolFormatValid: 0,
  toolFormatTotal: 0,
  stepCount: 1,
  latencyMs: 10,
};
const outcome = { steps: [] } as unknown as AgentRunOutcome;

describe('LangfuseTracer', () => {
  it('mặc định (LANGFUSE_ENABLED chưa đặt) → disabled, record no-op', async () => {
    const tracer = new LangfuseTracer(mockConfigService());
    expect(tracer.enabled).toBe(false);
    await expect(tracer.record(result, outcome)).resolves.toBeUndefined();
  });

  it('bật nhưng thiếu key → config validation ném', () => {
    expect(() => mockConfigService({}, { LANGFUSE_ENABLED: 'true' })).toThrow(
      /LANGFUSE_PUBLIC_KEY/,
    );
  });

  it('bật + đủ key → enabled', () => {
    const tracer = new LangfuseTracer(
      mockConfigService(
        {},
        {
          LANGFUSE_ENABLED: 'true',
          LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
          LANGFUSE_SECRET_KEY: 'sk-lf-test',
        },
      ),
    );
    expect(tracer.enabled).toBe(true);
    return tracer.onModuleDestroy();
  });
});
