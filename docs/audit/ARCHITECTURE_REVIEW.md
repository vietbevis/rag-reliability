# ARCHITECTURE AUDIT & REVIEW

## 1. Documented vs Actual Implementation

| Architectural Component | Documented (PROMPT & Architecture Docs) | Actual Code Implementation | Status / Variance |
| :--- | :--- | :--- | :--- |
| **Pipeline Framework** | NestJS + LangChain.js / LangGraph.js orchestration | Pure NestJS Services with direct LangChain primitives (`@langchain/openai`, `@langchain/textsplitters`, etc.). No LangGraph state graph in main query path. | **DOCUMENTED VS ACTUAL VARIANCE**: Orchestration is procedural NestJS dependency injection rather than LangGraph state graph. |
| **Document Ingestion** | `anydoc` -> Normalize -> Clean -> Dedup -> Quality -> Chunk -> Embed -> Graph | Fully matches: `AnydocParserService` -> `DocumentNormalizerService` -> `DocumentCleanerService` -> `DocumentDeduplicatorService` -> `DocumentQualityService` -> `ChunkingService` -> `ChunkEmbeddingService` -> `GraphIngestionService`. | **MATCHES** |
| **Chunking** | Fixed vs Structure-aware (Markdown) vs Semantic | `StructureAwareChunkerService` and `FixedSizeChunkerService` implemented. Semantic chunking is **NOT AVAILABLE**. | **PARTIAL**: Semantic chunking missing. |
| **Retrieval Strategies** | Vector, Keyword, Graph, Hybrid (RRF/Weighted) | Fully implemented: `VectorRetrieverService` (pgvector cosine), `KeywordRetrieverService` (Postgres FTS GIN), `GraphRetrieverService` (Neo4j 3-tier linking + BFS), `fusion.ts` (RRF/Weighted). | **MATCHES** |
| **Reranker** | LLM Listwise Reranker with fallback identity | `LlmRerankerProvider` + `NoopRerankerProvider` + `FakeRerankerProvider` in `RerankerFactoryService`. | **MATCHES** |
| **Grounding & Abstention** | ContextValidator (pre-gen) + Strict Grounding (post-gen) + Regenerate once | Fully implemented: `ContextValidatorService` + `AnswerGenerationService` with structured schema and token overlap check. | **MATCHES** |
| **Verification & Citation** | Claim extraction (LLM) -> Lexical Evidence Matching -> Contradiction -> NLI Verifier -> Citation mapping | Implemented via `ClaimExtractorService`, `EvidenceMatcherService`, `ContradictionDetector`, `FaithfulnessService`, `CitationService`. | **MATCHES** |

---

## 2. NestJS Architecture & Module Boundaries

### 2.1. Module Cohesion & Separation of Concerns
- **`AppModule`:** Imports `ConfigModule`, `DatabaseModule`, `HealthModule`, `DocumentsModule`, `RagModule`, `RagGraphModule`, `EvaluationModule`, and `AiModule`.
- **`AiModule` (`@Global()`):** Provides `LlmFactoryService`, `LlmService`, `EmbeddingFactoryService`, `EmbeddingService`, `RerankerFactoryService`, `RerankerService`, and `TokenCounterService`. Clean abstraction over AI providers.
- **`RagModule`:** Encapsulates Ingestion, Chunking, Retrieval, Context, Grounding, and Pipeline. Highly modular and testable.
- **`DatabaseModule` (`@Global()`):** Houses `PrismaService` using the modern `@prisma/adapter-pg` driver adapter.

### 2.2. Error Handling & Resilience
- Custom error hierarchy rooted in `AppError` (`IngestionError`, `ParserError`, `EmbeddingError`, `LlmError`, `ConfigError`).
- Centralized `AllExceptionsFilter` converts domain errors into consistent JSON responses with appropriate HTTP status codes (400, 404, 422, 500, 502).
- Circuit breaker pattern applied in `GraphRetrieverService` (trips after 3 consecutive failures, cools down for 30s) to prevent cascading Neo4j outages from stalling RAG queries.
- Safe fallback mechanism in `RerankerService`: any failure in LLM reranking seamlessly falls back to identity ranking without crashing the user request.

---

## 3. Database & pgvector Architecture

- **PostgreSQL 16 + pgvector:**
  - Table `Embedding`: `embedding` column defined as `vector(1536)`.
  - HNSW Index: `CREATE INDEX "Embedding_embedding_hnsw_cosine_idx" ON "Embedding" USING hnsw ("embedding" vector_cosine_ops)`.
  - Table `DocumentChunk`: generated column `contentTsv` (`to_tsvector('simple', content)`) with GIN index `DocumentChunk_contentTsv_idx`.
- **Driver Adapter Integration:**
  - Uses Prisma 7 with `@prisma/adapter-pg` + `pg.Pool`.
  - Unsupported types (`vector`, `tsvector`) are cleanly queried via `prisma.$queryRaw` without blocking standard ORM operations on metadata.

---

## 4. Framework Usage & Dependency Lock-in

- **LangChain Abstractions:** Utilized minimally where advantageous (e.g. `OpenAIEmbeddings`, `ChatOpenAI`, `ChatGoogleGenerativeAI`, `ChatAnthropic`, `RecursiveCharacterTextSplitter`).
- **Low Lock-in Risk:** Core business logic (Grounding validation, Deduplication, Claim-to-evidence lexical matching, RRF Fusion, Abstention gating) is written in pure TypeScript without proprietary framework lock-in.

---

## 5. Architectural Recommendations

1. **Implement Event-Driven Asynchronous Ingestion:** Current `DocumentsService.create` processes parse -> clean -> chunk -> embed -> graph synchronously in a single HTTP request. For multi-page PDFs, this risks HTTP connection timeouts. Move heavy ingestion steps to a background worker queue (BullMQ / Redis or Postgres LISTEN/NOTIFY).
2. **Dynamic Vector Dimension Support:** Abstract pgvector schema management to support multiple vector dimensions (1024d for `intfloat/multilingual-e5-large`, 768d for Gemini, 1536d for OpenAI) dynamically or via parameterized migrations.
3. **Consolidate Multi-call Pipeline:** A single query currently incurs 4-5 round-trip LLM invocations (Generate, Claim Extract, Faithfulness Verify, Answer Judge). Consolidate claim generation directly into the initial structured answer schema to reduce latency by ~60%.
