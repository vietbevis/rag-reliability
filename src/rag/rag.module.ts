import { Module } from '@nestjs/common';
import { ParsersModule } from '../documents/parsers/parsers.module';
import { DocumentCleanerService } from './ingestion/document-cleaner.service';
import { DocumentDeduplicatorService } from './ingestion/document-deduplicator.service';
import { DocumentNormalizerService } from './ingestion/document-normalizer.service';
import { DocumentQualityService } from './ingestion/document-quality.service';
import { IngestionService } from './ingestion/ingestion.service';

/**
 * Lõi RAG. PHASE 1: pipeline ingestion (normalize -> clean -> dedup ->
 * quality). Các phase sau thêm chunking, retrieval, grounding, evaluation.
 */
@Module({
  imports: [ParsersModule],
  providers: [
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
    DocumentDeduplicatorService,
    IngestionService,
  ],
  exports: [
    IngestionService,
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
  ],
})
export class RagModule {}
