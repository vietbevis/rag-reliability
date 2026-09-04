import { Module, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { RagModule } from '../rag/rag.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentController } from './agent.controller';
import { AgentEnabledGuard } from './agent-enabled.guard';
import { AgentService } from './agent.service';
import { AgentGraphBuilder } from './graph/agent-graph.builder';
import {
  AGENT_RUN_QUEUE,
  agentQueueEnabled,
} from './queue/agent-queue.constants';
import { AgentQueueService } from './queue/agent-queue.service';
import { AgentRunProcessor } from './queue/agent-run.processor';

const AGENT_QUEUE_KEY = 'agentQueue';
const queueOn = agentQueueEnabled();

/** BullMQ chỉ nạp khi `QUEUE_ENABLED` — connection riêng (`configKey`). */
const queueImports = queueOn
  ? [
      BullModule.forRootAsync(AGENT_QUEUE_KEY, {
        inject: [ConfigService],
        useFactory: (config: ConfigService<AppConfig, true>) => {
          const q = config.get('queue', { infer: true });
          return {
            connection: {
              host: q.redis.host,
              port: q.redis.port,
              password: q.redis.password,
              db: q.redis.db,
            },
          };
        },
      }),
      BullModule.registerQueue({
        configKey: AGENT_QUEUE_KEY,
        name: AGENT_RUN_QUEUE,
      }),
    ]
  : [];

const queueProviders: Provider[] = queueOn ? [AgentRunProcessor] : [];

/**
 * Agent Runtime (Agent Reliability Platform). Tool đến từ {@link ToolsModule}
 * (LocalToolProvider + MCPToolProvider từ config) — Agent Core KHÔNG biết
 * provider nào. Observability qua {@link AGENT_TRACER} (interface), không phụ
 * thuộc Langfuse trực tiếp. `AGENT_ENABLED=false` ⇒ route bị khoá (service vẫn
 * chạy cho test/eval/benchmark).
 */
@Module({
  imports: [RagModule, ToolsModule, ObservabilityModule, ...queueImports],
  controllers: [AgentController],
  providers: [
    AgentGraphBuilder,
    AgentService,
    AgentQueueService,
    AgentEnabledGuard,
    ...queueProviders,
  ],
  exports: [ToolsModule, AgentGraphBuilder, AgentService],
})
export class AgentModule {}
