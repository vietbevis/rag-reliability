import type { TokenUsage } from '../common/types';
import type { FailureClass } from '../tools/core/failure';
import type { ToolError } from '../tools/core/tool.types';

/**
 * Trừu tượng tracing (target-state.md §10). Agent Core CHỈ biết interface này —
 * KHÔNG import Langfuse/OTel trực tiếp (PROMPT §33). Adapter cụ thể ở
 * `src/observability/langfuse.tracer.ts`.
 */
export interface ToolCallEvent {
  stepId: string;
  providerId?: string;
  toolId: string;
  source?: string;
  arguments: unknown;
  startedAt: number;
  endedAt: number;
  latencyMs: number;
  result?: unknown;
  error?: ToolError | string;
}

export interface StepEvent {
  stepId: string;
  type: string;
  note?: string;
  tokens?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
}

export interface RunEndEvent {
  status: string;
  finalStatus?: string | null;
  answer?: string | null;
  failureClass?: FailureClass | null;
  usage: TokenUsage;
}

export interface RunSpan {
  toolCall(e: ToolCallEvent): void;
  step(e: StepEvent): void;
  end(e: RunEndEvent): void;
}

export interface Tracer {
  readonly enabled: boolean;
  startRun(input: {
    runId: string;
    task: string;
    metadata?: Record<string, unknown>;
  }): RunSpan;
}

/** Token DI cho {@link Tracer}. */
export const AGENT_TRACER = Symbol('AGENT_TRACER');

/** Tracer no-op — mặc định khi không bật observability nào. */
export class NoopTracer implements Tracer {
  readonly enabled = false;
  startRun(): RunSpan {
    return {
      toolCall: () => undefined,
      step: () => undefined,
      end: () => undefined,
    };
  }
}
