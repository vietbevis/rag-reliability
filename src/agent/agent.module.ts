import { Module, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { RagModule } from '../rag/rag.module';
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
import { CalculatorTool } from './tools/builtin/calculator.tool';
import { CurrentTimeTool } from './tools/builtin/current-time.tool';
import { RagSearchTool } from './tools/rag-search.tool';
import { AGENT_TOOLS, type AgentTool } from './tools/tool.interface';
import { ToolRegistryService } from './tools/tool-registry.service';

const AGENT_QUEUE_KEY = 'agentQueue';
const queueOn = agentQueueEnabled();

/** BullMQ chỉ nạp khi `QUEUE_ENABLED` — connection riêng (`configKey`) để không
 * đụng queue xử lý tài liệu. */
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
 * Agent tool-calling (PHASE 17). Xem `docs/architecture/agent-tools.md`.
 *
 * 17.0 config · 17.1 tool-calling LLM · 17.2 tool + registry · 17.3 graph +
 * guard · 17.4 rag_search · 17.5 finalize verify · 17.6 persistence · 17.7 HTTP
 * sync · 17.8 async BullMQ + cancel + SSE. `AGENT_ENABLED=false` ⇒ route bị
 * {@link AgentEnabledGuard} khoá (service vẫn chạy cho test/eval).
 */
@Module({
  imports: [RagModule, ...queueImports],
  controllers: [AgentController],
  providers: [
    CalculatorTool,
    CurrentTimeTool,
    RagSearchTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [CalculatorTool, CurrentTimeTool, RagSearchTool],
    },
    ToolRegistryService,
    AgentGraphBuilder,
    AgentService,
    AgentQueueService,
    AgentEnabledGuard,
    ...queueProviders,
  ],
  exports: [ToolRegistryService, AgentGraphBuilder, AgentService],
})
export class AgentModule {}
