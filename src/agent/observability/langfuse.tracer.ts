import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';
import type { AppConfig } from '../../config/configuration';
import { sanitizeTrace } from '../../common/observability/trace-sanitizer.util';
import type { AgentRunOutcome } from '../graph/agent-graph.builder';
import type { AgentRunResult } from '../agent.service';

/**
 * Ghi mỗi agent run vào Langfuse self-host (PHASE 17.9) — 1 trace / run, 1 span
 * / step. **Best-effort**: Langfuse chết hoặc chưa cấu hình ⇒ no-op, KHÔNG bao
 * giờ làm hỏng run (agent-tools.md §11). `AgentRun.trace` trong Postgres vẫn là
 * nguồn sự thật.
 *
 * Dùng SDK `langfuse` v3 (REST thuần, không đụng LangChain) — `langfuse-langchain`
 * 3.x kẹt peer `langchain <0.4`, còn `@langfuse/langchain` 5.x cần OTel NodeSDK.
 */
@Injectable()
export class LangfuseTracer implements OnModuleDestroy {
  private readonly logger = new Logger(LangfuseTracer.name);
  private readonly client: Langfuse | null;

  constructor(config: ConfigService<AppConfig, true>) {
    const cfg = config.get('langfuse', { infer: true });
    if (cfg.enabled && cfg.publicKey && cfg.secretKey) {
      this.client = new Langfuse({
        publicKey: cfg.publicKey,
        secretKey: cfg.secretKey,
        baseUrl: cfg.host,
      });
      this.logger.log(`Langfuse tracing BẬT → ${cfg.host}`);
    } else {
      this.client = null;
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Ghi một run đã hoàn tất. Không await ở nơi gọi (fire-and-forget). */
  async record(
    result: AgentRunResult,
    outcome: AgentRunOutcome,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const now = Date.now();
      const startMs = now - (result.latencyMs || 0);
      const trace = this.client.trace({
        id: result.id,
        name: 'agent.run',
        input: result.task,
        output: result.answer,
        tags: [
          `status:${result.status}`,
          `final:${result.finalStatus ?? 'none'}`,
          `stop:${result.stopReason}`,
        ],
        metadata: sanitizeTrace({
          finalStatus: result.finalStatus,
          stopReason: result.stopReason,
          toolCallCount: result.toolCallCount,
          stepCount: result.stepCount,
          latencyMs: result.latencyMs,
          usage: result.usage,
          error: result.error,
        }),
      });

      let cursor = startMs;
      for (const step of outcome.steps) {
        const dur = step.latencyMs ?? 0;
        trace.span({
          name: step.toolName ? `tool:${step.toolName}` : `step:${step.type}`,
          startTime: new Date(cursor),
          endTime: new Date(cursor + dur),
          input: step.toolInput as Record<string, unknown> | undefined,
          output: sanitizeTrace(step.toolOutput ?? step.note),
          level: step.error ? 'ERROR' : 'DEFAULT',
          statusMessage: step.error,
          metadata: { index: step.index, type: step.type },
        });
        cursor += dur;
      }

      await this.client.flushAsync();
    } catch (err) {
      this.logger.warn(
        `Langfuse ghi trace lỗi (bỏ qua): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdownAsync().catch(() => undefined);
  }
}
