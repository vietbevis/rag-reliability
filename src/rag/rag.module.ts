import { Module } from '@nestjs/common';
import { ParsersModule } from '../documents/parsers/parsers.module';
import { ChunkQualityService } from './chunking/chunk-quality.service';
import { ChunkerFactoryService } from './chunking/chunker-factory.service';
import { ChunkingService } from './chunking/chunking.service';
import { FixedSizeChunkerService } from './chunking/fixed-size-chunker.service';
import { StructureAwareChunkerService } from './chunking/structure-aware-chunker.service';
import { DocumentCleanerService } from './ingestion/document-cleaner.service';
import { DocumentDeduplicatorService } from './ingestion/document-deduplicator.service';
import { DocumentNormalizerService } from './ingestion/document-normalizer.service';
import { DocumentQualityService } from './ingestion/document-quality.service';
import { IngestionService } from './ingestion/ingestion.service';

/**
 * Lõi RAG.
 *   PHASE 1: pipeline ingestion (normalize -> clean -> dedup -> quality)
 *   PHASE 2: chunking (structure-aware | fixed) + chunk quality
 * Các phase sau thêm embedding, retrieval, grounding, evaluation.
 */
@Module({
  imports: [ParsersModule],
  providers: [
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
    DocumentDeduplicatorService,
    IngestionService,
    StructureAwareChunkerService,
    FixedSizeChunkerService,
    ChunkerFactoryService,
    ChunkQualityService,
    ChunkingService,
  ],
  exports: [
    IngestionService,
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
    ChunkingService,
    ChunkerFactoryService,
    ChunkQualityService,
  ],
})
export class RagModule {}
