# FAITHFULNESS & CLAIM VERIFICATION AUDIT

## 1. Claim-Level Evaluation Architecture

The faithfulness and claim verification subsystem operates in four stages:
1. **`ClaimExtractorService`:** Breaks the generated answer into atomic claims (`c1`, `c2`, ...). It assigns server-side claim IDs to prevent LLM hallucination of identifiers.
2. **`EvidenceMatcherService`:** Computes lexical token overlap (claim-recall) between each claim text and the retrieved context chunks (`minOverlap = 0.5`, `maxPerClaim = 3`).
3. **`ContradictionDetector`:** Inspects semantic negation pairs and numeric discrepancies between claims and chunks.
4. **`FaithfulnessService`:** Synthesizes claim verdicts (`SUPPORTED`, `UNSUPPORTED`, `CONTRADICTED`), calculates overall faithfulness score, and assigns root-cause attribution.

---

## 2. Faithfulness Benchmark Results

### Measured Values on the `answerable` Dataset (\(N = 5\))

| Metric | Without Verifier | With Faithfulness Verifier | Measured Delta (\(\Delta\)) |
| :--- | :---: | :---: | :---: |
| **Mean Faithfulness Score** | 0.0000 | 0.0000 | 0.0000 |
| **Claim Support Rate** | 33.33% | 33.33% | 0.00% |
| **Unsupported Claim Rate** | 0.00% | 0.00% | 0.00% |
| **False Contradiction Rate** | **100.0%** | **100.0%** | 0.00% |
| **Citation Valid Rate** | 100.0% | 100.0% | 0.00% |
| **Answer Correctness** | 0.7000 | 0.7000 | 0.0000 |
| **Average Query Latency** | 13,760 ms | 8,957 ms | -4,803 ms |

---

## 3. Deep Root Cause Analysis of the Faithfulness Metric Failure

> [!CRITICAL]
> ### [P0] Heuristic Contradiction Detector Destroys Faithfulness Scores
> **Symptom:** Every single answer in the `answerable` dataset received a faithfulness score of `0.0000` and status `CONFLICTING_EVIDENCE`, despite the generated answers being 100% factually grounded in the retrieved text.
> 
> **Step-by-Step Execution Trace:**
> 1. **User Question:** *"Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?"*
> 2. **Retrieved Context Chunks:**
>    - Chunk 1 (Điều 1): *"Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp..."*
>    - Chunk 2 (Điều 3): *"Trong thời gian bảo lưu, sinh viên **không được** đăng ký học phần, **không được** dự thi..."*
> 3. **Generated Answer:** *"Sinh viên **được** phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học."*
> 4. **Claim Extraction:** Claim `c1` = *"Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học."*
> 5. **Evidence Matching:** Matches Chunk 1 with token overlap > 0.80 -> marked `SUPPORTED`.
> 6. **Contradiction Detection Execution (`contradiction-detector.ts:64`):**
>    - Scans `NEGATION_PAIRS` = `[['không', 'không được'], ['được', 'cho phép']]`.
>    - Claim contains `"được"`.
>    - Chunk 2 (Điều 3, present in retrieved context) contains `"không được"`.
>    - Evaluates: `claimHasPos && chunkHasNeg && !claimHasNeg` -> **EVALUATES TRUE**!
>    - Flags: `contradicts: true`, `reason: Claim mang tính khẳng định (được) trong khi chunk chứa từ phủ định`.
> 7. **Status Mutation in `RagPipelineService`:**
>    - Because `contradiction.contradicts` is true, the pipeline immediately overrides the status to `CONFLICTING_EVIDENCE`.
>    - Faithfulness calculation assigns score `0.0` to any contradictory verdict.
> 
> **Architectural Fix:**
> - Remove broad keyword-level negation pairing between answers and unrelated retrieved chunks.
> - Contradiction detection must only compare a claim against its **matching evidence chunk** (Chunk 1), not across the entire multi-chunk context.
> - Transition to an LLM/NLI natural language inference verifier with full premise-hypothesis sentence structure rather than token substring matching.
