# Metrics đánh giá RAG (PROMPT §33-34)

> Nguyên tắc (§59): không nói "cách này tốt hơn" — chứng minh
> _"Recall@5 tăng X→Y, Faithfulness tăng A→B, latency +C ms, cost +D%,
> provider Z model W"_. Mọi metric dưới đây được tính trên **golden dataset**
> (`evaluation/datasets/*.jsonl`) và lưu vào `EvaluationRun.metrics`.

Ký hiệu: `K` = top-K (mặc định 5). `relevant` = tập id (chunk hoặc document)
được đánh dấu đúng trong golden case (`expectedChunks` / `expectedDocuments`).
`retrieved@K` = K id đầu tiên retrieval trả về, theo thứ hạng.

---

## Retrieval metrics (§33) — **đo được từ PHASE 4**

| Metric | Công thức | Ý nghĩa | Hạn chế |
|---|---|---|---|
| **Recall@K** | `|retrieved@K ∩ relevant| / |relevant|` | Bao nhiêu % evidence cần thiết lọt vào top-K | Cần golden `expectedChunks` đầy đủ; chunk id phụ thuộc chiến lược chunking → so sánh ở mức document khi đổi chunker |
| **Precision@K** | `|retrieved@K ∩ relevant| / K` | Bao nhiêu % top-K là evidence thật (nhiễu ít hay nhiều) | Phạt nặng khi `|relevant| < K` |
| **MRR** | `mean(1 / rank_of_first_relevant)` | Evidence đầu tiên nằm ở hạng bao nhiêu (trung bình nghịch đảo) | Chỉ quan tâm 1 hit đầu tiên |
| **NDCG@K** | `DCG@K / IDCG@K`, `DCG = Σ rel_i / log2(i+1)` | Xếp hạng có tốt không (evidence quan trọng ở trên) | Cần điểm relevance nhị phân/thang; hiện dùng nhị phân |
| **Context Precision** | tỉ lệ chunk trong **context cuối** (sau builder/budget) thuộc `relevant` | Context đưa vào LLM sạch cỡ nào | Sau token-budget nên phụ thuộc `MAX_CONTEXT_TOKENS` |
| **Context Recall** | tỉ lệ `relevant` xuất hiện trong **context cuối** | Sau khi cắt token có còn đủ evidence không | — |

Chạy nhanh (không tốn LLM): `npm run evaluate:retrieval`.

---

## Generation metrics (§34)

| Metric | Cách tính (PHASE 4 baseline) | Trạng thái |
|---|---|---|
| **Abstention Accuracy** | case `answerable=false` → đúng khi `status = INSUFFICIENT_EVIDENCE`; case `answerable=true` → đúng khi KHÔNG abstain. `= #đúng / #tổng` | ✅ đo được |
| **Answer Correctness** | LLM-judge: so `actualAnswer` vs `expectedAnswer` → score 0..1. Bỏ qua (null) khi `expectedAnswer` null hoặc LLM chưa cấu hình | ✅ (LLM-judge; PHASE 10 thêm rubric + human spot-check) |
| **Citation Accuracy** | tỉ lệ citation trả về có `chunkId ∈ expectedChunks` **hoặc** `documentId ∈ expectedDocuments` (lỏng — document-level cho baseline) | ✅ thô |
| **Hallucination Rate (proxy)** | `#(answerable, không abstain, answerCorrectness < 0.3) / #tổng` | ⚠️ **proxy** — hallucination thật cần claim-level faithfulness (PHASE 9) |
| **Faithfulness** | mỗi claim của answer có được chunk hỗ trợ không: `#supported / #claims` | ⏳ PHASE 9 (claim extraction + evidence matching) |
| **Answer Relevance** | answer có trả lời đúng câu hỏi không (embedding similarity giữa câu hỏi và câu hỏi-tái-sinh-từ-answer, hoặc LLM-judge) | ⏳ PHASE 10 |

### Vì sao "Hallucination Rate" ở PHASE 4 chỉ là proxy

Hallucination thật (§28) = answer khẳng định điều **không** có trong evidence.
Đo đúng cần tách answer → claims → đối chiếu từng claim với chunk
(`FaithfulnessService`, PHASE 9). Trước đó chỉ ước lượng gián tiếp qua
"answerable nhưng trả lời sai" — bỏ sót trường hợp trả lời đúng **tình cờ** dù
không grounded, và trường hợp evidence sai (BAD_SOURCE_DATA).

### Failure layer (§28) — phân loại gốc rễ

Mỗi `EvaluationResult` cố gắng gán `failureLayer`:
`RETRIEVAL_FAILURE` (expected chunk không lọt top-K) ·
`MISSING_CONTEXT` / `IRRELEVANT_CONTEXT` (retrieval OK nhưng context builder
loại) · `GENERATION_HALLUCINATION` (context đủ nhưng answer sai) ·
`CITATION_HALLUCINATION` (citation trỏ sai chunk) ·
`CONFLICTING_CONTEXT` / `BAD_SOURCE_DATA` (P9).

---

## Cách chạy

| Lệnh | Nội dung |
|---|---|
| `npm run evaluate:retrieval` | Chỉ retrieval metrics trên toàn bộ dataset — nhanh, không tốn LLM |
| `npm run evaluate` | Đầy đủ (retrieval + generation). `-- --baseline` để đánh dấu `EvaluationRun.isBaseline`. Exit ≠ 0 nếu regression so với baseline (§37) |
| `POST /evaluation/run` `{ datasetName, label?, mode?, isBaseline?, topK? }` | Chạy một run qua API |
| `GET /evaluation/runs?datasetName=` | Liệt kê run |
| `GET /evaluation/runs/:id` | Kết quả tổng hợp + per-case |
| `POST /evaluation/runs/:id/compare` | Delta so với baseline run cùng dataset |

`EvaluationRun.metrics` tổng hợp gồm cả `provider`, `model`, `chunkingStrategy`,
`avgLatencyMs`, `totalCost` — để mọi so sánh nêu rõ điều kiện (§4.5, §36).

---

## Regression (§37) — mầm cho PHASE 12

`BenchmarkService.compareToBaseline(runId)` so run hiện tại với run
`isBaseline=true` cùng dataset. `regressed = true` nếu:

- Recall@5 giảm > 5%, **hoặc**
- Hallucination Rate (proxy) tăng > 3%, **hoặc**
- Faithfulness giảm > 5% (khi có — P9).

CI gọi `npm run evaluate` → exit code ≠ 0 khi `regressed` → fail build.
