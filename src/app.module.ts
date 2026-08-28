import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AllExceptionsFilter } from './common/errors';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';

/**
 * RAG Reliability Service — wiring của PHASE 0.
 *
 * Các module được thêm theo từng phase (PROMPT §47):
 *   PHASE 0  config · database · ai (đa provider) · documents/parsers · health
 *   PHASE 1+ ingestion · chunking · retrieval · grounding · evaluation
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AiModule,
    DocumentsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
