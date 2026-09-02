// Bootstrap Nest application context (không HTTP) để chạy agent với LLM THẬT.
// Dùng bởi promptfoo provider. Yêu cầu `nest build` chạy trước (đọc từ dist/).
import 'dotenv/config';

process.env.AGENT_ENABLED = 'true';
process.env.QUEUE_ENABLED = 'false';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'custom';

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../../dist/app.module.js');
const { AgentService } = await import('../../dist/agent/agent.service.js');

let ctxPromise;

async function context() {
  ctxPromise ??= NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  return ctxPromise;
}

/** Chạy một task, trả trajectory phẳng cho agent-metrics. */
export async function runAgentTask(task) {
  const ctx = await context();
  const agent = ctx.get(AgentService);
  const r = await agent.run(task);
  return {
    answer: r.answer,
    finalStatus: r.finalStatus,
    stopReason: r.stopReason,
    status: r.status,
    toolsUsed: r.toolsUsed,
    stepCount: r.stepCount,
    toolCallCount: r.toolCallCount,
    formatValid: r.toolFormatValid,
    formatTotal: r.toolFormatTotal,
    usage: r.usage,
    latencyMs: r.latencyMs,
  };
}

export async function shutdown() {
  if (ctxPromise) await (await ctxPromise).close();
}
