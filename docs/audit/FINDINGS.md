# PRIORITIZED FINDINGS & TECHNICAL VULNERABILITIES

## P0 — Critical (Showstoppers / System Invalidation)

### [P0-1] Heuristic Contradiction Detector Destroys Faithfulness Scores
- **Evidence:** 100% of grounded answers on the `answerable` dataset were erroneously classified as `CONFLICTING_EVIDENCE`, forcing measured `Faithfulness = 0.0000` and `claimLevelHallucinationRate = 0.6667`.
- **Impact:** System falsely reports that grounded answers contradict knowledge base, causing false regression alerts in CI/CD and corrupting production telemetry.
- **Root Cause:** In `contradiction-detector.ts:64`, `NEGATION_PAIRS` checks if the answer contains any positive word (*"được"*) and ANY retrieved chunk contains any negative word (*"không"*, *"không được"*). Because college regulations naturally contain negative rules (e.g. *"không được dự thi nếu vắng quá 20%"*), valid affirmative answers trigger false contradictions.
- **Recommendation:** Restrict contradiction checking strictly between a claim and its matching evidence chunk (not entire context), or migrate to an LLM/NLI verifier with complete sentence context.

### [P0-2] Exact Deduplication Deadlock on Incomplete Ingestion
- **Evidence:** Documents `quy-che-bao-luu-2023`, `thong-bao-bao-luu-2024`, `huong-dan-hoc-vu`, `thong-bao-tai-chinh` became permanently stuck in `REJECTED` status, resulting in `Recall@5 = 0.00` on the `conflicting` dataset.
- **Impact:** Any ingestion run that experiences an intermittent network or provider error during embedding leaves an orphaned document record that blocks all subsequent attempts to ingest that document.
- **Root Cause:** In `document-deduplicator.service.ts`, the deduplication query excludes only `[REJECTED, FAILED]`, matching documents left in `EMBEDDING` status. When re-ingestion is attempted, the new document is rejected as an exact duplicate of the uncompleted version.
- **Recommendation:** Exclude uncompleted documents (`EMBEDDING`, `PARSING`, `CLEANING`) older than 10 minutes from duplicate locking, or allow re-ingest to overwrite uncompleted records.

---

## P1 — High (Severe Functional & Accuracy Degradation)

### [P1-1] Keyword Retrieval Fails on Natural Language Questions
- **Evidence:** Keyword retrieval scored `Recall@5 = 0.0000` and `MRR = 0.0000` on full question inputs across all datasets.
- **Impact:** In hybrid retrieval, keyword search contributes 0 candidates on natural language queries, eliminating the benefits of hybrid fusion.
- **Root Cause:** `KeywordRetrieverService` passes raw questions directly to `websearch_to_tsquery('simple', query)`, which joins all words with boolean `&` (AND). Interrogative words (*"mấy"*, *"bao nhiêu"*) not present in documents cause 0 matches.
- **Recommendation:** Strip stopwords and interrogatives before tsquery generation, or use PostgreSQL `plainto_tsquery` / BM25 ranking extension.

### [P1-2] Hardcoded Vector Dimensions (1536d) Blocking `intfloat/multilingual-e5-large`
- **Evidence:** Table `Embedding` has column `embedding vector(1536)`. Switching to `intfloat/multilingual-e5-large` (1024d) causes database insertion errors.
- **Impact:** System cannot switch to open-source multilingual embedding models without manual schema alterations.
- **Root Cause:** Dimension 1536 is hardcoded in SQL migration `20260828165529_phase3_embedding_index`. E5 models also require asymmetric prefixes (`"query: "` / `"passage: "`) which are currently absent in `ChunkEmbeddingService`.
- **Recommendation:** Add migration for `vector(1024)` and support model-specific query/passage prefixing in embedding services.

### [P1-3] Golden Dataset Scale Inadequacy (\(N = 18\))
- **Evidence:** Total evaluation dataset contains only 18 cases across 5 files.
- **Impact:** Benchmark results carry high margin of error and cannot statistically validate production readiness.
- **Recommendation:** Expand golden dataset to at least 100+ cases across 10 query categories.

---

## P2 — Medium (Operational & Stability Risks)

### [P2-1] Missing Rate Limiting and API Authentication
- **Evidence:** Public REST controllers (`rag.controller.ts`, `documents.controller.ts`) lack `@UseGuards(AuthGuard)` and `@UseGuards(ThrottlerGuard)`.
- **Impact:** Vulnerable to API denial-of-service and unauthorized document mutation in public deployments.
- **Recommendation:** Integrate `@nestjs/throttler` and API key / JWT authentication middleware.

### [P2-2] Foreign Key Violation on Citation Persistence in Multi-threaded / Test Scenarios
- **Evidence:** `Citation_documentId_fkey` constraint violation observed during E2E test runs in `rag-pipeline.service.ts:526`.
- **Impact:** Query requests can throw HTTP 500 errors if document records are concurrently removed.
- **Recommendation:** Enforce transaction isolation and verify document existence before persisting citations.

---

## P3 — Low (Technical Debt & Minor Cleanups)

### [P3-1] Semantic Chunking Absent in Factory
- **Evidence:** `ChunkerFactoryService` only implements `structure` and `fixed`; `semantic` chunking is not available.
- **Impact:** Cannot evaluate semantic boundary splitting against markdown-aware splitting.
- **Recommendation:** Implement embedding-distance-based semantic chunker or document as deliberate exclusion.
