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

## Quy trình một experiment

1. `npm run evaluate -- --baseline` một lần để chốt baseline (nếu chưa có cho
   dataset đó).
2. Đổi **đúng một** biến (env hoặc flag).
3. `npm run evaluate -- answerable --label=exp-002-hybrid`.
4. `POST /evaluation/runs/:id/compare` hoặc đọc CLI output → bảng delta.
5. Ghi kết luận vào `docs/experiments/` (một file / experiment) theo mẫu:
   _config · dataset version · metrics before/after · latency · token · cost ·
   provider + model · kết luận_.

## Golden dataset

`evaluation/datasets/`: `answerable.jsonl` · `unanswerable.jsonl` ·
`adversarial.jsonl` · `multi-hop.jsonl`. Loại case (PROMPT §32):
`DIRECT_RETRIEVAL` · `MULTI_HOP` · `UNANSWERABLE` · `ADVERSARIAL` ·
`CONFLICTING_SOURCES` · `EXACT_IDENTIFIER` · `SEMANTIC_QUERY`. Mỗi case mang
`corpus` (tài liệu cần ingest) để dataset tự đủ, tái tạo được.
