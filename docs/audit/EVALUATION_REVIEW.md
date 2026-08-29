# EVALUATION FRAMEWORK & GOLDEN DATASET AUDIT

## 1. Golden Dataset Quality & Composition

The repository ships with an evaluation harness located in `evaluation/datasets/` containing 5 JSONL datasets:

| Dataset File | Total Cases | Query Types Included | Intended Purpose | Audit Assessment |
| :--- | :---: | :--- | :--- | :--- |
| **`answerable.jsonl`** | 5 | `DIRECT_RETRIEVAL`, `SEMANTIC_QUERY`, `EXACT_IDENTIFIER` | Gold standard answerable university policy questions | High quality questions, but sample size (\(N=5\)) is far too small. |
| **`adversarial.jsonl`** | 4 | `ADVERSARIAL` | False premises, inflated numbers, invalid requirements | Tests abstention vs correction behavior (\(N=4\)). |
| **`conflicting.jsonl`** | 2 | `CONFLICTING_SOURCES` | Policy revisions between 2023 and 2024 regulations | Tests conflict note & dual attribution (\(N=2\)). Ingestion locked. |
| **`multi-hop.jsonl`** | 3 | `MULTI_HOP` | Cross-regulation queries (leaves -> fees, absent -> GPA) | Tests 2-hop traversal and composite context (\(N=3\)). |
| **`unanswerable.jsonl`** | 4 | `UNANSWERABLE` | Out-of-corpus topics (dorm fees, professor leaves, football) | Tests strict abstention (\(N=4\)). |
| **TOTAL** | **18** | Multi-category coverage | Comprehensive RAG Evaluation | **LOW STATISTICAL CONFIDENCE** |

---

## 2. Statistical Validity & Confidence Analysis

> [!WARNING]
> ### Statistical Confidence Warning
> With total \(N = 18\) cases across the entire repository (and individual evaluation slices ranging from \(N = 2\) to \(N = 5\)), any metric calculation (e.g. `Recall@5 = 100%`, `Precision@5 = 25%`, `Pass Rate = 80%`) carries **high margin of error / LOW STATISTICAL CONFIDENCE**.
> A single failure in a 4-case dataset moves the aggregate score by **25.0%**.

---

## 3. Evaluation Metric Implementation

- **Retrieval Metrics (`retrieval-metrics.ts`):**
  - `recallAtK`: Correctly computes \(|\text{Retrieved} \cap \text{Expected}| / |\text{Expected}|\).
  - `precisionAtK`: Computes \(|\text{Retrieved} \cap \text{Expected}| / K\).
  - `mrr`: Mean Reciprocal Rank \(1 / \text{rank}_{\text{first\_relevant}}\).
  - `ndcgAtK`: Normalized Discounted Cumulative Gain with binary relevance discounts \(\log_2(\text{rank} + 1)\).
  - `contextPrecision`: Average precision across relevant positions.
  - `contextRecall`: Binary recall across all retrieved documents.
- **Generation Metrics (`generation-metrics.ts`):**
  - `citationAccuracy`: Matches cited document IDs against gold expected document IDs.
  - `claimLevelHallucinationRate`: Computes \(|\text{unsupported} + \text{contradicted}| / |\text{total claims}|\).
  - `abstentionAccuracy`: Correctly rewards `INSUFFICIENT_EVIDENCE` on unanswerable cases and penalizes on answerable cases.

---

## 4. Recommendations for Production Evaluation

1. **Scale Golden Dataset to \(N \ge 100\):** Expand from 18 cases to at least 100+ cases with balanced distribution across 10 query categories.
2. **Automated Synthetic Test Generation (RAGAS / G-Eval style):** Implement synthetic question generation from ingested documents with automatic ground-truth extraction for continuous evaluation.
3. **Statistical Confidence Reporting:** Output 95% Bootstrap Confidence Intervals alongside mean metrics in evaluation CLI outputs.
