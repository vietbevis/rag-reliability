import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';
import type { AppConfig } from '../config/configuration';
import { sanitizeTrace } from '../common/observability/trace-sanitizer.util';
import {
  type RunEndEvent,
  type RunSpan,
  type StepEvent,
  type ToolCallEvent,
  type Tracer,
} from './tracer';

/**
 * Adapter {@link Tracer} → Langfuse self-host (target-state.md §10). 1 trace /
 * run + 1 span / tool-call/step. **Best-effort**: Langfuse chết / chưa cấu hình
 * ⇒ no-op, KHÔNG bao giờ làm hỏng run. `AgentRun.trace` (Postgres) vẫn là nguồn
 * sự thật.
 *
 * SDK `langfuse` v3 (REST thuần) — không callback handler LangChain (lệch peer).
 */
@Injectable()
export class LangfuseTracer implements Tracer, OnModuleDestroy {
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

  startRun(input: {
    runId: string;
    task: string;
    metadata?: Record<string, unknown>;
  }): RunSpan {
    if (!this.client) {
      return { toolCall: () => {}, step: () => {}, end: () => {} };
    }
    const client = this.client;
    const logger = this.logger;
    const toolCalls: ToolCallEvent[] = [];
    const steps: StepEvent[] = [];

    return {
      toolCall: (e) => toolCalls.push(e),
      step: (e) => steps.push(e),
      end: (e: RunEndEvent) => {
        try {
          const trace = client.trace({
            id: input.runId,
            name: 'agent.run',
            input: input.task,
            output: e.answer,
            tags: [
              `status:${e.status}`,
              `final:${e.finalStatus ?? 'none'}`,
              ...(e.failureClass ? [`failure:${e.failureClass}`] : []),
            ],
            metadata: sanitizeTrace({
              ...input.metadata,
              finalStatus: e.finalStatus,
              failureClass: e.failureClass,
              usage: e.usage,
            }),
          });
          for (const s of steps) {
            trace.span({
              name: `step:${s.type}`,
              output: sanitizeTrace(s.note),
              metadata: { stepId: s.stepId, tokens: s.tokens },
            });
          }
          for (const t of toolCalls) {
            trace.span({
              name: `tool:${t.toolId}`,
              startTime: new Date(t.startedAt),
              endTime: new Date(t.endedAt),
              input: sanitizeTrace(t.arguments) as Record<string, unknown>,
              output: sanitizeTrace(t.result ?? null),
              level: t.error ? 'ERROR' : 'DEFAULT',
              statusMessage:
                typeof t.error === 'string' ? t.error : t.error?.message,
              metadata: {
                stepId: t.stepId,
                providerId: t.providerId,
                source: t.source,
                latencyMs: t.latencyMs,
                errorCode:
                  typeof t.error === 'object' ? t.error.code : undefined,
              },
            });
          }
          void client.flushAsync();
        } catch (err) {
          logger.warn(
            `Langfuse ghi trace lỗi (bỏ qua): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdownAsync().catch(() => undefined);
  }
}
