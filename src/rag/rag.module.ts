import { Module } from '@nestjs/common';
import { ParsersModule } from '../documents/parsers/parsers.module';
import { ChunkQualityService } from './chunking/chunk-quality.service';
import { ChunkerFactoryService } from './chunking/chunker-factory.service';
import { ChunkingService } from './chunking/chunking.service';
import { FixedSizeChunkerService } from './chunking/fixed-size-chunker.service';
import { SemanticChunkerService } from './chunking/semantic-chunker.service';
import { StructureAwareChunkerService } from './chunking/structure-aware-chunker.service';
import { ChunkEmbeddingService } from './embedding/chunk-embedding.service';
import { VectorSchemaService } from './embedding/vector-schema.service';
import { DocumentCleanerService } from './ingestion/document-cleaner.service';
import { DocumentDeduplicatorService } from './ingestion/document-deduplicator.service';
import { DocumentNormalizerService } from './ingestion/document-normalizer.service';
import { DocumentQualityService } from './ingestion/document-quality.service';
import { IngestionService } from './ingestion/ingestion.service';
import { VectorRetrieverService } from './retrieval/vector-retriever.service';
import { KeywordRetrieverService } from './retrieval/keyword-retriever.service';
import { GraphEntityLinkerService } from './retrieval/graph-entity-linker.service';
import { GraphRetrieverService } from './retrieval/graph-retriever.service';
import { RetrievalService } from './retrieval/retrieval.service';
import { ContextBuilderService } from './context/context-builder.service';
import { ContextValidatorService } from './context/context-validator.service';
import { AnswerGenerationService } from './grounding/answer-generation.service';
import { ClaimExtractorService } from './grounding/claim-extractor.service';
import { EvidenceMatcherService } from './grounding/evidence-matcher.service';
import { CitationService } from './grounding/citation.service';
import { FaithfulnessService } from './grounding/faithfulness.service';
import { RagPipelineService } from './pipeline/rag-pipeline.service';
import { RagController } from './rag.controller';

/**
 * Lõi RAG.
 *   PHASE 1: ingestion (normalize -> clean -> dedup -> quality)
 *   PHASE 2: chunking (structure-aware | fixed) + chunk quality
 *   PHASE 3: embedding đa provider (batch) + lưu pgvector
 *   PHASE 4: baseline RAG — vector retrieval -> context -> validate -> generate
 *   PHASE 5-9: graph, keyword/hybrid, rerank, strict grounding, claim citation
 *   PHASE 10: faithfulness verifier + contradiction detection
 */
@Module({
  imports: [ParsersModule],
  controllers: [RagController],
  providers: [
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
    DocumentDeduplicatorService,
    IngestionService,
    StructureAwareChunkerService,
    FixedSizeChunkerService,
    SemanticChunkerService,
    ChunkerFactoryService,
    ChunkQualityService,
    ChunkingService,
    VectorSchemaService,
    ChunkEmbeddingService,
    VectorRetrieverService,
    KeywordRetrieverService,
    GraphEntityLinkerService,
    GraphRetrieverService,
    RetrievalService,
    ContextBuilderService,
    ContextValidatorService,
    AnswerGenerationService,
    ClaimExtractorService,
    EvidenceMatcherService,
    CitationService,
    FaithfulnessService,
    RagPipelineService,
  ],
  exports: [
    IngestionService,
    DocumentNormalizerService,
    DocumentCleanerService,
    DocumentQualityService,
    ChunkingService,
    ChunkerFactoryService,
    ChunkQualityService,
    ChunkEmbeddingService,
    VectorSchemaService,
    RetrievalService,
    ContextBuilderService,
    FaithfulnessService,
    RagPipelineService,
  ],
})
export class RagModule {}
