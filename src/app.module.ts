import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentModule } from './agent/agent.module';
import { AiModule } from './ai/ai.module';
import { AllExceptionsFilter } from './common/errors';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { ConsoleModule } from './console/console.module';
import { RagModule } from './rag/rag.module';

/**
 * RAG Reliability Service — wiring.
 *
 * Các module được thêm theo từng phase (PROMPT §47):
 *   PHASE 0  config · database · ai (đa provider) · parsers · health
 *   PHASE 1  rag/ingestion · documents (upload + CRUD)
 *   PHASE 2-3 chunking · embedding (pgvector)
 *   PHASE 4  rag/retrieval · rag/context · rag/grounding · rag/pipeline · evaluation
 *   PHASE 5  graph (Neo4j) · rag/graph (entity/quan hệ → Neo4j)
 *   PHASE 17 agent (tool-calling — read-first, có kiểm soát)
 */
@Module({
  imports: [
    ConfigModule,
    RateLimitModule,
    DatabaseModule,
    AiModule,
    GraphModule,
    RagModule,
    DocumentsModule,
    EvaluationModule,
    HealthModule,
    ConsoleModule,
    AgentModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
