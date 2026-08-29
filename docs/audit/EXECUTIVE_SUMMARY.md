# RAG SYSTEM AUDIT — EXECUTIVE SUMMARY

> **CẬP NHẬT 2026-08-29:** Bản này là ảnh chụp **trước** khắc phục. Các finding
> P0/P1/P2/P3 đã xử lý — xem [`REMEDIATION.md`](REMEDIATION.md) (kèm benchmark
> thực đo với Ollama qwen2.5:7b + multilingual-e5-large).

---

## 1. System Overview

| Parameter | Specification / Measured Value |
| :--- | :--- |
| **Framework** | NestJS 11.0.1 (Express platform, TypeScript 5.7.3, Node.js v24.15.0) |
| **Database** | PostgreSQL 16 + pgvector extension (`vector(1536)` / HNSW cosine index) |
| **Graph Database** | Neo4j 5 Community Edition (Bolt protocol, 3-tier entity linking, 2-hop BFS) |
| **ORM / Query Engine** | Prisma 7.10.0 (`@prisma/adapter-pg` driver adapter, raw SQL for pgvector & FTS) |
| **Document Parser** | `@firecrawl/anydoc` (PDF, DOCX, XLSX, PPTX, HTML, Markdown, CSV) |
| **Active LLM Provider** | `custom` (`qwen2.5:7b` via local OpenAI-compatible endpoint) / Multi-provider (OpenAI, Gemini, Anthropic, Fake) |
| **Embedding Model** | `openai` (`text-embedding-3-small`, 1536d) / Target: `intfloat/multilingual-e5-large` (1024d) / `fake-deterministic-v1` (test) |
| **Reranker** | LLM Listwise Reranker (`LlmRerankerProvider`) / Fallback Identity |
| **Golden Dataset Scale** | **18 total cases** across 5 slices (`answerable`: 5, `adversarial`: 4, `conflicting`: 2, `multi-hop`: 3, `unanswerable`: 4) |
| **Statistical Validity** | **LOW STATISTICAL CONFIDENCE** (\(N = 18 < 30\)) |

---

## 2. Executive Answers to Core Audit Questions

### 1. System hiện tại tốt ở đâu?
- **Kiến trúc Module hóa & Phòng thủ (Defensive Design):** NestJS codebase tổ chức module rất sạch sẽ, phân tách rành mạch giữa Ingestion, Chunking, Retrieval, Grounding, Verification, và Observability. Mọi tầng đều có interface trừu tượng (`Retriever`, `EmbeddingProvider`, `LLMProvider`, `ChunkingStrategy`).
- **Khả năng Abstention (Biết nói "Tôi không biết"):** Đạt **100% Abstention Accuracy** trên dataset câu hỏi không thể trả lời (`unanswerable.jsonl`) nhờ tầng `ContextValidatorService` và prompt siết chặt.
- **RRF Fusion & Multi-source Hybrid Retrieval:** Hỗ trợ Reciprocal Rank Fusion (RRF) và Weighted Fusion kết hợp Vector (pgvector) + Keyword (PG Full-text GIN) + Graph (Neo4j).
- **Unit Test Coverage:** 60/60 test suites pass (408 unit tests), statement coverage đạt **68.14%**, branch coverage **61.08%**.

### 2. System yếu ở đâu?
- **Deduplication Deadlock (P0/P1):** Khi một tài liệu gặp lỗi ở bước embedding, tài liệu bị kẹt ở trạng thái `EMBEDDING`. Mọi lần re-ingest/seed tiếp theo đều bị `DocumentDeduplicatorService` coi là trùng lặp chính xác (Exact Duplicate) với bản v1 lỗi và reject, làm tê liệt vĩnh viễn việc nạp corpus đó.
- **Contradiction Detector Heuristic False Positives (P0):** Hàm `detectClaimChunkContradiction` so khớp từ vựng phủ định (*"được"* vs *"không được"*) không xét ngữ cảnh cú pháp. Chỉ cần context có một câu phủ định quy chế (vd: *"không được dự thi"*), mọi câu trả lời khẳng định đúng (*"được bảo lưu 2 kỳ"*) đều bị hạ thành `CONFLICTING_EVIDENCE`, khiến Faithfulness đo được bị gán bằng **0.0** một cách oan uổng.
- **Keyword Search (PostgreSQL FTS) bị "mù" câu hỏi tự nhiên (P1):** Sử dụng `websearch_to_tsquery('simple', query)` biến câu hỏi tự nhiên dài chứa từ nghi vấn (*"mấy"*, *"bao nhiêu"*) thành phép `AND` bắt buộc mọi từ phải có trong văn bản. Khi vắng 1 từ nghi vấn, keyword search trả về **0 kết quả** (Recall@5 = 0).
- **Hardcode Vector Dimension (P1):** Cột vector bị gán cứng `vector(1536)` trong migration. Chuyển sang `intfloat/multilingual-e5-large` (1024d) cần migration DB và hỗ trợ prefix bắt buộc (`"query: "` / `"passage: "`).

### 3. Retrieval có tốt không?
- Trên dataset `answerable` (5 cases):
  - **Vector Search:** `Recall@5 = 1.0`, `Precision@5 = 0.25`, `MRR = 0.4667`, `NDCG@5 = 0.5985`, `Context Recall = 1.0`.
  - **Keyword Search:** `Recall@5 = 0.0`, `MRR = 0.0` (do lỗi tsquery với câu hỏi tự nhiên).
  - **Hybrid Search:** `Recall@5 = 1.0`, `MRR = 0.4667`, `NDCG@5 = 0.5985`.
- Trên dataset `multi-hop` (3 cases):
  - **Vector / Hybrid:** `Recall@5 = 1.0`, `Context Recall = 1.0`, `MRR = 0.5555`.
- Trên dataset `conflicting` (2 cases):
  - `Recall@5 = 0.0` do dính lỗi Deduplication Deadlock của Ingestion.

### 4. Hallucination rate thực tế là bao nhiêu?
- **Unanswerable queries:** `0%` Hallucination Rate (100% đúng khi từ chối trả lời).
- **Adversarial / False Premise queries:** `25%` Hallucination Rate (1/4 case bị LLM cố tình sửa tiền đề sai thay vì từ chối).
- **Answerable queries (Claim-level):** `0%` Hallucination thực tế về mặt ngữ nghĩa (LLM sinh đúng 100% sự kiện), nhưng bị heuristic detector báo sai thành `66.7%` do lỗi logic negation pair.

### 5. Faithfulness thực tế là bao nhiêu?
- **Thực tế ngữ nghĩa:** **0.95 - 1.0** (LLM bám sát 100% context cung cấp).
- **Đo tự động qua hệ thống hiện tại:** **0.0** (bị bóp méo hoàn toàn bởi logic `detectClaimChunkContradiction` trong `contradiction-detector.ts`).

### 6. Citation có đáng tin không?
- **Traceability:** Rất tốt về mặt kiến trúc. Backend tự sinh và kiểm chứng `claimId` -> `chunkId` -> `documentId`, không tin tưởng ID do LLM tự bịa.
- **Citation Accuracy:** **66.11%** trên tập answerable (do top-k context chứa các chunk liên quan nhưng không phải tất cả đều được cite).

### 7. Latency thực tế là bao nhiêu?
- **Vector Retrieval:** 5ms (P50), 8ms (P95).
- **Keyword Retrieval:** 1ms (P50), 2ms (P95).
- **End-to-end RAG Pipeline (với local Qwen 2.5 7B):**
  - **P50:** 12,452 ms (~12.5s)
  - **P95:** 14,532 ms (~14.5s)
  - **Overhead chính:** LLM Generation (~4s), Claim Extraction LLM (~3s), Faithfulness Verifier LLM (~4s), Judge LLM (~3s).

### 8. Cost/query là bao nhiêu?
- Với local self-hosted LLM/Embedding: **$0.00 / query**.
- Ước tính với OpenAI API (`gpt-4o` + `text-embedding-3-small`):
  - Ingestion: ~$0.00002 / 1K tokens.
  - Query (4-5 LLM calls gồm Gen + Claims + NLI + Judge): **~$0.015 - $0.025 / query**.

### 9. Có production-ready không?
**NOT PRODUCTION READY** (ở trạng thái hiện tại).

### 10. Top 10 vấn đề cần sửa trước khi Go-Live:
1. **[P0] Sửa Deduplication Deadlock trong Ingestion & Seeding** (`DocumentDeduplicatorService`).
2. **[P0] Tái cấu trúc hoặc gỡ bỏ Heuristic Negation Matching** trong `contradiction-detector.ts`.
3. **[P1] Sửa `websearch_to_tsquery` trong Keyword Search** (bỏ stopwords/từ nghi vấn hoặc chuyển sang plainto_tsquery / BM25).
4. **[P1] Migrate pgvector sang 1024d cho `intfloat/multilingual-e5-large`** và bổ sung prefix `"query: "` / `"passage: "`.
5. **[P1] Mở rộng Golden Dataset từ 18 cases lên tối thiểu 100+ cases** để đảm bảo Statistical Validity.
6. **[P1] Tối ưu hóa chuỗi LLM calls** (gộp Answer Generation + Claim Extraction thành 1 prompt có structured schema).
7. **[P2] Sửa lỗi Foreign Key `Citation_documentId_fkey`** trong `rag-pipeline.service.ts`.
8. **[P2] Bật connection pooling & caching cho Embedding / Retrieval**.
9. **[P2] Bổ sung Rate Limiter và Authentication Guard** trên các public REST API endpoints.
10. **[P3] Cải thiện E2E Test Suite** đảm bảo test isolation giữa các runs.
