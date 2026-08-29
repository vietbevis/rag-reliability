# RETRIEVAL BENCHMARK & STRATEGY COMPARISON

## 1. Chunking Strategy Benchmark

We evaluated `StructureAwareChunkerService` vs `FixedSizeChunkerService` on representative institutional regulatory text (Vietnamese university academic regulations with headings, sections, articles, and markdown tables).

| Strategy | Chunks Count | Avg Tokens | P50 Chunk Tokens | P95 Chunk Tokens | Min Tokens | Max Tokens | Heading Context Preservation |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Structure-aware (Markdown)** | 6 | 134 | 148 | 196 | 32 | 196 | **100%** (All 6 chunks carry breadcrumb hierarchy) |
| **Fixed-size (LangChain baseline)** | 3 | 258 | 261 | 275 | 240 | 275 | **0%** (Split blindly without heading metadata) |
| **Semantic Chunking** | `NOT AVAILABLE` | `NOT AVAILABLE` | `NOT AVAILABLE` | `NOT AVAILABLE` | `NOT AVAILABLE` | `NOT AVAILABLE` | `NOT AVAILABLE` (Not implemented in factory) |

### Key Chunking Observations
- `StructureAwareChunkerService` cleanly isolates individual regulatory articles (e.g. Điều 1, Điều 2, Điều 3, Điều 4) into discrete semantic units and attaches hierarchical breadcrumbs (e.g. `Quy chế đào tạo > Chương II > Điều 4`).
- Tables (such as the GPA grading conversion table) are retained in full without being severed across arbitrary token boundaries.

---

## 2. Retrieval Strategy Comparison

Empirical evaluation conducted on the `answerable` evaluation dataset across 4 retrieval strategies (Vector, Keyword, Graph, Hybrid Fusion):

| Strategy | Recall@5 | Precision@5 | MRR | NDCG@5 | Context Precision | Context Recall | P95 Latency | Cost / Query |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Vector only (pgvector cosine)** | **1.0000** | 0.2500 | 0.4667 | 0.5985 | 0.4667 | **1.0000** | **8 ms** | $0.00 |
| **Keyword only (PostgreSQL FTS)** | **0.0000** | 0.0000 | 0.0000 | 0.0000 | 0.0000 | **0.0000** | **2 ms** | $0.00 |
| **Graph only (Neo4j local BFS)** | **0.0000** | 0.0000 | 0.0000 | 0.0000 | 0.0000 | **0.0000** | **1 ms** | $0.00 |
| **Hybrid (RRF Fusion: Vector+KW+Graph)** | **1.0000** | 0.2500 | 0.4667 | 0.5985 | 0.4667 | **1.0000** | **5 ms** | $0.00 |
| **Hybrid + LLM Reranker (`exp-003`)** | **1.0000** | 0.2500 | 0.4667 | 0.5985 | 0.4667 | **1.0000** | **8,957 ms** | $0.00 (local) |

---

## 3. Deep Analysis & Tradeoff Evaluation

### 3.1. Vector vs Keyword vs Hybrid Performance
- **Vector Retrieval:** Delivers excellent recall (`Recall@5 = 1.0`, `Context Recall = 1.0`) with minimal latency (~5ms).
- **Keyword Retrieval Degradation:**
  - `websearch_to_tsquery('simple', query)` generates an `AND` query across all tokens in natural language questions.
  - Question words like *"mấy"*, *"bao nhiêu"*, *"như thế nào"* that do not appear in policy text cause PostgreSQL FTS to return **0 chunks** on full natural language questions.
  - When searched with raw keywords (e.g. *"bảo lưu học kỳ"*), Keyword FTS succeeds with 5 matches.
  - **Recommendation:** Preprocess questions with stopword/interrogative removal before feeding to `tsquery`, or use `plainto_tsquery` / BM25.

### 3.2. Reranker Audit & Tradeoff
- On the current golden dataset (small corpus with 15 chunks), enabling LLM listwise reranker yielded **0% metric improvement** on `Recall@5` (1.0 -> 1.0), `MRR` (0.4667 -> 0.4667), and `Context Precision` (0.4667 -> 0.4667).
- **Latency Overhead:** The LLM listwise reranker introduced **~8,900 ms** latency overhead per query.
- **Verdict on Reranker:** In small-to-medium corpora where vector retrieval top-5 already captures all gold evidence, an LLM listwise reranker is **not cost/latency justified**. It should only be enabled when candidate pools are large (\(K \ge 50\)) and re-ranked using a fast cross-encoder (e.g. `bge-reranker-large` / FlashRank) rather than a generative LLM call.

---

## 4. Evaluation Across Query Types

| Query Category | Dataset Slice | Measured Recall@5 | Measured Context Recall |
| :--- | :--- | :---: | :---: |
| **Direct Policy Lookup** | `answerable` (baoluu, hocphi) | **1.00** | **1.00** |
| **Semantic Query** | `answerable` (thi-dieukien) | **1.00** | **1.00** |
| **Exact Identifier** | `answerable` (totnghiep-gpa) | **1.00** | **1.00** |
| **Multi-hop Relational** | `multi-hop` (3 cases) | **1.00** | **1.00** |
| **Conflicting Sources** | `conflicting` (2 cases) | **0.00** *(Blocked by Dedup Deadlock)* | **0.00** |
| **Unanswerable Queries** | `unanswerable` (4 cases) | N/A (Abstention target) | N/A |
| **Adversarial / False Premise** | `adversarial` (4 cases) | N/A (Abstention target) | N/A |
