import { Module } from '@nestjs/common';
import { EntityExtractorService } from './entity-extractor.service';
import { GraphCleanupService } from './graph-cleanup.service';
import { GraphController } from './graph.controller';
import { GraphExtractionCacheService } from './graph-extraction-cache.service';
import { GraphIngestionService } from './graph-ingestion.service';
import { GraphQueryService } from './graph-query.service';
import { GraphWriteService } from './graph-write.service';

/**
 * Nghiệp vụ Graph RAG construction (PHASE 5) — dựng trên `GraphModule` (hạ tầng
 * Neo4j, @Global) và `AiModule` (LlmService, @Global). Xem
 * `docs/architecture/graph-rag.md`.
 */
@Module({
  controllers: [GraphController],
  providers: [
    EntityExtractorService,
    GraphExtractionCacheService,
    GraphCleanupService,
    GraphWriteService,
    GraphIngestionService,
    GraphQueryService,
  ],
  exports: [GraphIngestionService, GraphCleanupService, GraphQueryService],
})
export class RagGraphModule {}
