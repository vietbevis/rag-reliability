import { Global, Module } from '@nestjs/common';
import { LangfuseTracer } from './langfuse.tracer';
import { AGENT_TRACER } from './tracer';

/**
 * Observability (target-state.md §10). Cung cấp {@link AGENT_TRACER} (interface
 * `Tracer`) cho toàn app — adapter hiện tại là Langfuse (best-effort, tự no-op
 * khi tắt). Thêm adapter khác (OTel…) = đổi ở đây, KHÔNG đụng Agent Core.
 */
@Global()
@Module({
  providers: [
    LangfuseTracer,
    { provide: AGENT_TRACER, useExisting: LangfuseTracer },
  ],
  exports: [AGENT_TRACER],
})
export class ObservabilityModule {}
