// promptfoo custom provider (PHASE 17.10): mỗi test-case → 1 agent run thật.
import { runAgentTask } from './build-agent.mjs';

export default class AgentProvider {
  id() {
    return 'rag-agent';
  }

  async callApi(prompt) {
    try {
      const t = await runAgentTask(prompt);
      return {
        output: t.answer ?? '(agent không trả câu trả lời)',
        tokenUsage: {
          total: (t.usage?.inputTokens ?? 0) + (t.usage?.outputTokens ?? 0),
          prompt: t.usage?.inputTokens ?? 0,
          completion: t.usage?.outputTokens ?? 0,
        },
        cost: t.usage?.estimatedCost ?? 0,
        metadata: {
          finalStatus: t.finalStatus,
          stopReason: t.stopReason,
          status: t.status,
          toolsUsed: t.toolsUsed,
          stepCount: t.stepCount,
          toolCallCount: t.toolCallCount,
          formatValid: t.formatValid,
          formatTotal: t.formatTotal,
          latencyMs: t.latencyMs,
        },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
