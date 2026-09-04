# Experiments (PROMPT §36)

> Mỗi cải tiến = một experiment: thay **một** biến, chạy cùng golden dataset,
> ghi lại config / dataset version / metrics / latency / token / cost /
> provider + model (§36). Baseline (§35) là mốc — lưu
> `EvaluationRun.isBaseline = true`, mọi run sau `compareToBaseline`.

| #   | Tên                              | Giả thuyết                                                                  | Biến thay đổi                              | Metric quan tâm                                              | Phase |
| --- | -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ----- |
| 000 | **Baseline**                    | Fixed chunk + vector + prompt đơn giản cho một mốc đo được                 | —                                        | tất cả (lưu làm mốc)                                        | 4     |
| 001 | Fixed vs Structure chunking     | Structure-aware giữ semantic unit → Context Precision cao hơn, ít cắt câu | `CHUNKING_STRATEGY`                        | Recall@5, Context Precision, NDCG, avg chunk quality        | 2/4   |
| 002 | Vector vs Hybrid                | Thêm keyword giúp câu có mã văn bản / tên riêng / số quyết định (§17)     | retrieval strategy (vector → hybrid)      | Recall@5 theo loại case (EXACT_IDENTIFIER vs SEMANTIC)      | 6     |
| 003 | No rerank vs Rerank             | Rerank đẩy evidence đúng lên top-5 → Context Precision + Faithfulness cao | bật `RerankerService` (top-20 → top-5)   | Context Precision, MRR, Faithfulness, latency +, cost +     | 7     |
| 004 | Basic vs Grounded prompt        | Prompt nghiêm ngặt "chỉ dùng context" giảm hallucination                  | system prompt                            | Faithfulness, Hallucination Rate, Answer Correctness        | 8     |
| 005 | No verifier vs Faithfulness verifier | Verifier bắt câu trả lời không grounded → regenerate/abstain          | bật `FaithfulnessService` sau generation | Hallucination Rate, Abstention Accuracy, latency +, cost + | 9     |
| 006 | Multi-provider                  | So quality/cost/latency giữa OpenAI gpt-4o / Gemini 2.5 Flash / Claude Sonnet | `LLM_PROVIDER` + model                 | Faithfulness, Answer Correctness, latency, cost / 1k query  | 13    |
| 007 | Vector vs Graph vs Hybrid       | Graph traversal thắng ở multi-hop (§32 Type B); hybrid tổng hợp tốt nhất  | retrieval strategy + `GRAPH_RAG_ENABLED`  | Recall@5 & Context Recall theo `type`, cost extraction, latency | 6/13 |
| 008 | Data cleaning on/off            | Làm sạch tăng Recall (bớt nhiễu vào embedding)                            | tắt cleaner pipeline                      | Recall@5, Context Precision                                  | 11    |

## Quy trình và Cách thức chạy Experiment (PHASE 11)

### 1. Qua REST API
- `GET /evaluation/experiments`: Liệt kê các experiment chuẩn được hỗ trợ.
- `POST /evaluation/experiments/run`: Chạy một thực nghiệm tự động (trả về kết quả before, after và bảng deltas):
  ```json
  {
    "experimentId": "exp-003",
    "datasetName": "answerable",
    "topK": 5
  }
  ```

### 2. Qua CLI Terminal
- Liệt kê các experiment:
  ```bash
  npm run evaluate:experiment -- --list
  ```
- Chạy một experiment cụ thể:
  ```bash
  npm run evaluate:experiment -- exp-003
  npm run evaluate:experiment -- exp-005 --dataset=answerable
  ```
- Chạy toàn bộ experiment suite:
  ```bash
  npm run evaluate:experiment -- --all
  ```

## Golden dataset (PROMPT §31, §32)

Thư mục `evaluation/datasets/` — **210 case / 13 file** (PHASE 19). Xem đầy đủ
schema, category, metrics, benchmark methodology và cách thêm case ở
[`docs/evaluation-dataset.md`](../evaluation-dataset.md).

- `answerable.jsonl` · `semantic.jsonl` (paraphrase + keyword mismatch —
  benchmark embedding) · `numerical.jsonl` (số/port/version + temporal)
- `multi-hop.jsonl` · `cross-document.jsonl` (ghép ≥ 3 tài liệu) ·
  `conflicting.jsonl` (tài liệu mâu thuẫn)
- `unanswerable.jsonl` · `adversarial.jsonl` (tiền đề sai) ·
  `entity-disambiguation.jsonl` (thực thể tên gần giống)
- `distractor.jsonl` (nhiễu gần đúng + long-context) ·
  `vietnamese-robustness.jsonl` (typo / thiếu dấu / trộn Anh-Việt / khẩu ngữ)
- `agent-routing.jsonl` (RAG vs tool vs rag_and_tool) · `golden.jsonl`
  (regression suite ~23 case)

Bao gồm trọn vẹn 7 `type` (enum DB) + 15 `category` mịn. `npm run dataset:validate`
gate CI; `npm run dataset:stats` in phân bố.

