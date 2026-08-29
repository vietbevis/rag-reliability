import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AllExceptionsFilter } from './common/errors';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
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
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AiModule,
    GraphModule,
    RagModule,
    DocumentsModule,
    EvaluationModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
