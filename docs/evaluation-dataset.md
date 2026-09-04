# RAG / Agent Evaluation Dataset (PHASE 19)

> Mục tiêu: biến `rag-reliability` thành một **reproducible RAG/Agent evaluation
> benchmark** — không chỉ "hệ thống trả lời được không" mà **tách được lỗi ở
> tầng nào**: embedding → retriever → reranker → context → generation →
> hallucination → agent routing.

```
                    ┌─ Embedding failure   (semantic / keyword_mismatch / vietnamese_robustness)
Query ── Retrieval ─┼─ Retriever failure   (recall@k, MRR, nDCG theo category)
                    └─ Reranker failure    (contextPrecision / MRR trước vs sau rerank)
                              │
                              ↓ Context (contextRecall / contextPrecision)
                              ↓
                         LLM / Agent
                              │
                    ┌─────────┴─────────┐
                    ↓                   ↓
             Generation error     Hallucination
       (requiredFactRecall)   (forbiddenClaimRate / abstentionAccuracy /
                               hallucinationRateProxy / claimLevelHallucinationRate)
```

---

## 1. Kiến trúc dataset

Mở rộng hạ tầng có sẵn (KHÔNG dựng cây song song):

| Thành phần | Vị trí | Vai trò |
|---|---|---|
| Schema | `src/evaluation/datasets/case.schema.ts` (Zod) | 1 dòng JSONL = 1 case, tự mang `corpus` |
| Loader | `src/evaluation/datasets/dataset-loader.service.ts` | đọc + validate `EVAL_DATASETS_DIR` (mặc định `evaluation/datasets/`) |
| Seeder | `src/evaluation/datasets/dataset-seed.service.ts` | ingest `corpus` qua `DocumentsService`, upsert `EvaluationDataset`/`EvaluationCase` (field mở rộng vào `EvaluationCase.metadata`) |
| Runner | `src/evaluation/evaluation.service.ts` | `mode: 'retrieval'` (nhanh, không LLM) \| `'full'` |
| Metrics | `src/evaluation/metrics/*` | retrieval / generation / fact / agent — hàm thuần |
| Corpus lib | `scripts/eval-corpus.mjs` | MỘT nguồn sự thật cho corpus dùng chung — 2 generator cùng import (tránh re-declare cùng `source` với text khác ⇒ pipeline reject exact-dup) |
| Generator | `scripts/gen-eval-datasets.mjs` (5 file lõi) + `scripts/gen-eval-datasets-extended.mjs` (8 file PHASE 19) | case khai báo → JSONL |
| Validate / Stats | `scripts/validate-datasets.mjs` · `scripts/dataset-stats.mjs` | `npm run dataset:validate` · `dataset:stats` |
| Embedding matrix | `evaluation/embedding-matrix.json` + `src/evaluation/cli/embedding-benchmark.ts` | `npm run evaluate:embeddings` |

Mỗi case **tự chứa corpus** → seed độc lập, không phụ thuộc trạng thái DB. Đơn
vị đánh giá retrieval là `source` tài liệu (chunk id sinh lúc ingest, phụ thuộc
chunker → so ở mức document khi đổi chunking).

---

## 2. Schema

```jsonc
{
  "id": "num-redis-port-current",           // duy nhất toàn dataset
  "type": "EXACT_IDENTIFIER",               // 1 trong 7 — lưu cột EvaluationCase.type (enum)
  "category": "temporal",                   // phân loại mịn (15 giá trị) — lưu metadata
  "difficulty": "hard",                     // easy | medium | hard | expert
  "reasoningSteps": 2,                      // số chunk/bước cần nối
  "language": "vi",                         // vi | en | mixed
  "question": "Phiên bản hiện tại dùng Redis ở cổng nào?",
  "answerable": true,
  "expectedAnswer": "Cổng 6380 (từ phiên bản 2.0, 03/2025; trước là 6379).",
  "acceptableAnswers": [],                  // biến thể được LLM-judge chấp nhận
  "expectedDocuments": ["htqldt-kien-truc-2025"],   // gold (source) — recall/precision/MRR/nDCG
  "alternativeDocuments": [],               // cũng trả lời được — không phạt
  "distractorDocuments": ["htqldt-kien-truc-2023"], // nhiễu gần giống, sai fact (§15)
  "expectedChunks": [],
  "requiredFacts": ["6380"],                // câu trả lời PHẢI chứa (§11)
  "forbiddenClaims": ["6379 là cổng hiện tại"], // lộ ra = hallucination (§12)
  "shouldAbstain": false,
  "negativeType": null,                     // completely_unknown | related_unsupported | attribute_missing | similar_concept | false_premise | conflicting_premise
  "expectedAction": null,                   // rag | tool | rag_and_tool (chỉ agent_routing)
  "metadata": { "robustness": "no_accent" },
  "corpus": [ { "title": "...", "source": "...", "text": "..." } ]
}
```

**Tương thích ngược:** mọi field sau `expectedAnswer` đều optional + có default —
JSONL PHASE 4 cũ vẫn parse. Field mở rộng lưu vào `EvaluationCase.metadata` JSON
→ **không cần migration**.

### Bất biến (schema `.refine` + `dataset:validate`)

- `answerable === (expectedAnswer !== null)`; `answerable ⇒ !shouldAbstain`
- `expectedDocuments` / `alternativeDocuments` / `distractorDocuments` ⊆ `corpus.source`
- 1 source không thể vừa gold vừa distractor
- `expectedAction` chỉ cho `category = agent_routing`
- `answerable=false ⇒ expectedDocuments = []`, có `negativeType`
- `multi_hop` / `cross_document ⇒ reasoningSteps ≥ 2`; `cross_document` / `CONFLICTING_SOURCES ⇒ ≥ 2 gold`
- không trùng id, không trùng câu hỏi (chuẩn hoá; `golden.jsonl` được miễn — regression pack cố ý tái dùng)
- không leakage (question không chứa nguyên văn expectedAnswer)
- `requiredFacts` phải suy được từ corpus gold (proxy token, chỉ category "trích trực tiếp")

---

## 3. Category & file

| File | Category chính | Đo lỗi tầng nào |
|---|---|---|
| `answerable.jsonl` | `direct_retrieval`, `semantic_paraphrase`, `numerical_exact` | retrieval cơ bản, generation |
| `semantic.jsonl` | `semantic_paraphrase`, `keyword_mismatch` | **embedding** (E5 vs Gemini): diễn đạt khác từ vựng |
| `numerical.jsonl` | `numerical_exact`, `temporal` | retrieval + generation số/port/version/ngày; suy luận trước–sau |
| `multi-hop.jsonl` | `multi_hop` | nối 2+ chunk/tài liệu |
| `cross-document.jsonl` | `cross_document` | ghép ≥ 3 tài liệu (RBAC + phạm vi + workflow) |
| `conflicting.jsonl` | `conflicting` | tài liệu mâu thuẫn / version-aware |
| `unanswerable.jsonl` | `unanswerable` | abstention (ngoài phạm vi) |
| `adversarial.jsonl` | `false_premise` | tiền đề sai / số bịa / điều kiện không tồn tại |
| `entity-disambiguation.jsonl` | `entity_disambiguation` | thực thể tên gần giống (Khoa CNTT vs CNTP, Phòng ĐT vs CTSV) |
| `distractor.jsonl` | `distractor`, `long_context` | tài liệu nhiễu gần đúng; fact chôn giữa văn bản dài |
| `vietnamese-robustness.jsonl` | `vietnamese_robustness` | typo / thiếu dấu / trộn Anh-Việt / khẩu ngữ / query ngắn / viết tắt / đồng nghĩa |
| `agent-routing.jsonl` | `agent_routing` | RAG vs tool vs rag_and_tool (§18) |
| `golden.jsonl` | (đa dạng) | regression suite ~23 case chất lượng cao |

### Negative (`answerable=false`) — PROMPT §5

`completely_unknown` · `related_unsupported` · `attribute_missing` (thực thể có,
thuộc tính không) · `similar_concept` · `false_premise` · `conflicting_premise`.
Trả "Tôi không biết" đúng lúc = **đạt**; bịa thông tin = **failure**.

### Agent routing — PROMPT §18

`expectedAction`:
- `rag` — trả lời được từ tài liệu (`answerable=true`, có `expectedDocuments`).
- `tool` — cần dữ liệu động (trạng thái đề xuất #123, số dư học phí…). RAG-only
  **phải abstain** ⇒ `answerable=false`. `metadata.toolHint` gợi ý tool.
- `rag_and_tool` — cần cả quy định (RAG) lẫn dữ liệu động (tool).
  `metadata.ruleDocuments` = phần quy định.

Evaluator agent-routing đầy đủ dùng agent + tool provider thật — dùng chung với
Agent Benchmark (`docs/benchmark/`). Trong RAG eval hiện tại, case `tool` được
tính như abstention (RAG-only **nên** từ chối → tín hiệu thật).

---

## 4. Metrics

### Retrieval (`mode: 'retrieval'` — không tốn LLM) — K = 5

`recallAt5` · `precisionAt5` · `mrr` · `ndcgAt5` · `contextPrecision` ·
`contextRecall`. Tính trên case **có `expectedDocuments`** (case unanswerable bị
loại khỏi mẫu). Định nghĩa: `src/evaluation/metrics/retrieval-metrics.ts`.

### Generation (`mode: 'full'`)

| Metric | Ý nghĩa |
|---|---|
| `abstentionAccuracy` | đúng lúc từ chối / đúng lúc trả lời |
| `answerCorrectness` | LLM-judge so `expectedAnswer` (0..1) |
| `requiredFactRecall` | tỉ lệ `requiredFacts` xuất hiện trong câu trả lời (tất định) |
| `forbiddenClaimRate` | tỉ lệ `forbiddenClaims` LỘ ra (cao = xấu) |
| `citationAccuracy` | citation trỏ đúng tài liệu gold |
| `faithfulness` / `claimLevelHallucinationRate` | claim-level (PHASE 9-10) |
| `hallucinationRateProxy` | answerable + không abstain + sai; hoặc unanswerable mà bịa |

`requiredFactRecall` / `forbiddenClaimRate`: `src/evaluation/metrics/fact-metrics.ts`
— chuẩn hoá không dấu + so độ phủ token (≥ 0.8). Proxy tất định, KHÔNG thay LLM-judge.

### Agent — `src/evaluation/metrics/agent-metrics.ts`

`toolSelection` (P/R/F1) · `forbiddenToolCompliance` · `abstentionCorrect` ·
`stepEfficiency` · `formatValidity`.

### System

`avgLatencyMs` · `totalCost` (embedding + LLM). `EvaluationRun.config` ghi kèm
`provider` / `model` / `chunkingStrategy` / `strategy` / `rerank` — mọi so sánh
nêu rõ điều kiện (§36).

### Failure layer (`EvaluationResult.failureLayer`)

`RETRIEVAL_FAILURE` · `MISSING_CONTEXT` · `GENERATION_HALLUCINATION` ·
`CITATION_HALLUCINATION` — phân loại gốc rễ mỗi case fail.

---

## 5. Chạy

```bash
npm run dataset:generate          # sinh lại JSONL từ generator (gốc + extended)
npm run dataset:validate          # schema Zod + bất biến chất lượng — exit≠0 nếu lỗi
npm run dataset:stats             # phân bố category / difficulty / language / negative…

npm run evaluate:retrieval                    # retrieval metrics, mọi dataset, không LLM
npm run evaluate:retrieval -- semantic golden  # chỉ định dataset
npm run evaluate                              # full (retrieval + generation) + so baseline
npm run evaluate -- golden --label=exp-XYZ    # 1 dataset, đặt nhãn
npm run evaluate -- --baseline                # chốt baseline (EvaluationRun.isBaseline)

npm run evaluate:experiment -- --strategies --dataset=semantic   # vector vs keyword vs graph vs hybrid
npm run evaluate:experiment -- exp-003                           # rerank on/off
npm run evaluate:embeddings                                      # ma trận đa embedding model
```

> CLI `evaluate` / `experiment` / `embedding-benchmark` tự đặt `QUEUE_ENABLED=false`
> (ingest corpus chạy inline — CLI không có BullMQ worker; nếu không tài liệu
> kẹt `QUEUED` và mọi số liệu retrieval = 0). `GRAPH_RAG_ENABLED=false` cho
> retrieval benchmark nhanh hơn.

Regression gate: `npm run evaluate` (không `--baseline`) so run hiện tại với
baseline cùng dataset (`BenchmarkService.compareToBaseline`), exit ≠ 0 nếu
recall@5 ↓ > 5đ%, hallucination proxy ↑ > 3đ%, faithfulness ↓ > 5đ%,
contextPrecision ↓ > 5đ%, hoặc latency > 1.5× baseline.

---

## 6. Thêm case mới

1. Thêm tài liệu vào `CORPUS` trong `scripts/gen-eval-datasets-extended.mjs`
   (nếu chưa có). Nội dung tự chứa, ngắn gọn, có heading Markdown.
2. Thêm case qua helper `C({ id, type, category, question, answer, docs, distract, requiredFacts, forbiddenClaims, ... })`.
3. `npm run dataset:generate && npm run dataset:validate && npm run dataset:stats`.
4. Chạy `node --experimental-vm-modules node_modules/jest/bin/jest.js src/evaluation/datasets`.

**Quy tắc chất lượng** (PROMPT §21, §29): không sinh hàng loạt bằng thay
tên/số; ưu tiên diversity & coverage; distractor phải đủ giống để gây nhầm
nhưng khác về fact; multi-hop phải thực sự cần nhiều chunk; negative phải thực
sự ngoài phạm vi corpus.

---

## 7. Golden dataset (§26)

`golden.jsonl` (~23 case, id `gold-*`, corpus tự chứa) — regression suite chạy
mỗi khi đổi embedding / chunking / retriever / reranker / prompt / LLM / agent
policy. Bao phủ: easy → expert, multi-hop, cross-document, negative,
conflicting, numerical, temporal, semantic, keyword_mismatch, entity, long
context, vietnamese_robustness, agent routing.

## 8. Adversarial (§27)

`adversarial.jsonl` + các case `false_premise` / `similar_concept` /
`attribute_missing` rải trong `entity-disambiguation.jsonl`,
`distractor.jsonl`, `numerical.jsonl`. Mục tiêu: **tìm failure mode**, không
chứng minh hệ thống chạy. Gồm tiền đề sai ("hệ thống dùng MongoDB…"), số bịa,
tài liệu cũ vẫn còn trong corpus, chunk gần đúng, typo/thiếu dấu, trộn ngôn
ngữ, thực thể mập mờ.

---

## 9. Retrieval độc lập với Generation

- **Retrieval failure**: `mode: 'retrieval'` → recall/precision/MRR/nDCG. Nếu
  `expectedDocuments` không lọt top-K ⇒ lỗi ở embedding/retriever/reranker,
  KHÔNG phải generation.
- **Generation failure**: `mode: 'full'` trên case retrieval OK (context đủ) mà
  `answerCorrectness` thấp / `requiredFactRecall` < 1 / `forbiddenClaimRate` > 0
  ⇒ lỗi ở LLM.
- `failureLayer` mỗi case tự động phân loại; không đánh đồng hai loại.

---

## 10. Metrics coverage → category

| Tầng | Category dùng để đo |
|---|---|
| Embedding | `semantic_paraphrase`, `keyword_mismatch`, `vietnamese_robustness`, `entity_disambiguation` |
| Retriever | `direct_retrieval`, `numerical_exact`, `multi_hop`, `distractor`, `long_context` |
| Reranker | `distractor`, `numerical_exact` (rerank on/off — exp-003) |
| Generation | `direct_retrieval`, `cross_document`, `multi_hop`, `temporal` (+ `requiredFacts`) |
| Hallucination | `unanswerable`, `false_premise`, `conflicting`, `adversarial` (+ `forbiddenClaims`) |
| Agent | `agent_routing` |

---

## 11. Benchmark methodology (§25, §36)

Mỗi cải tiến = **một** experiment: thay một biến, chạy cùng golden dataset, ghi
`config` / dataset version / metrics / latency / token / cost / provider +
model. Baseline (`isBaseline=true`) là mốc; mọi run sau `compareToBaseline`.
Không nói "cách này tốt hơn" — chứng minh *"recall@5 X→Y, faithfulness A→B,
latency +C ms, cost +D%"*.

---

## 12. So sánh embedding models (E5 vs Gemini vs …)

`evaluation/embedding-matrix.json` khai báo các entry (env override:
`EMBEDDING_PROVIDER`, model, dimension, prefix). `npm run evaluate:embeddings`:

```
for entry in matrix.entries:
  đặt env  →  Nest context mới  →  seed corpus  →  TRUNCATE "Embedding"
  →  re-embed toàn bộ chunk  →  evaluation.run({ mode: 'retrieval' }) trên các dataset
  →  gom recall@5 / precision@5 / mrr / ndcg@5 / contextRecall
```

Output: `benchmarks/embedding/results/<label>.json` + `comparison.json` + bảng:

```
                      e5-large   gemini-001   openai-3-large
semantic  recallAt5     0.84        0.89          0.87
semantic  mrr           0.78        0.84          0.81
numerical recallAt5     0.91        0.88          0.93
...
```

**RÀNG BUỘC dimension**: cột pgvector cố định **1024 chiều** (migration
`phase14_embedding_e5_1024`). Ma trận mặc định chọn model đều cấu hình được về
1024 (E5-large native; `gemini-embedding-001` cắt Matryoshka; OpenAI
`text-embedding-3-large` với `dimensions=1024`). Model chiều khác ⇒ migration
riêng hoặc DB/volume riêng (docker compose profile), rồi chạy lần lượt.

Sau khi chạy, embeddings trong DB là của **entry cuối** — chạy lại pipeline
(`POST /documents/:id/embed` hoặc re-ingest) để khôi phục cấu hình chính.

`EMBEDDING_QUERY_PREFIX` / `EMBEDDING_PASSAGE_PREFIX`: họ E5/GTE/BGE cần
`"query: "` / `"passage: "` bất đối xứng — ma trận đặt sẵn từng entry.

---

## 13. Remaining gaps

- **Retrieval KHÔNG scope theo case**: `EvaluationService` retrieve từ TOÀN BỘ
  document store, nên distractor / tài liệu mâu thuẫn của case *khác* lọt vào
  top-K (quan sát: `gold-baoluu` / `gold-vi-noaccent` dính `CONFLICTING_EVIDENCE`
  vì `thong-bao-bao-luu-2024` của case khác cùng trong DB). Nên filter retrieval
  theo `corpus` của case (`RetrievalFilters.documentIds`). Đổi hành vi này ảnh
  hưởng baseline lịch sử của cả 5 dataset gốc ⇒ quyết định riêng.
- **`citationAccuracy` document-level quá nghiêm** với corpus NOISE: citation
  trỏ vào chunk nhiễu hợp lệ vẫn bị tính sai ⇒ `CITATION_HALLUCINATION` giả
  (quan sát golden full: 11/13 fail là loại này dù `answerCorrectness ≈ 1.0`).
- **`forbiddenClaimRate` (proxy tất định)**: `claimLeaked()` STRICT đã bỏ phần
  lớn dương-tính-giả do câu phủ định, nhưng vẫn có thể dính khi cụm cấm rải rác
  quanh từ phủ định (vd "trưởng khoa KHÔNG thể tự phê duyệt"). Chọn cụm forbidden
  đủ đặc trưng; đánh giá đúng cần LLM-judge.
- **Chunk-level ground truth**: `expectedChunks` có trong schema nhưng eval so ở
  mức `source` (chunk id sinh lúc ingest). Recall@k chunk-level cần map sau seed.
- **Agent routing evaluator**: case `agent_routing` mới validate + thống kê +
  tính như abstention trong RAG eval; evaluator dùng agent + tool thật là việc
  của Agent Benchmark harness.
- **Recall@10 / nDCG@10**: runner hard-code K=5; cần tham số hoá `K`.
- **Human spot-check**: `answerCorrectness` là LLM-judge; chưa có vòng human
  review + rubric (PHASE 10).
- **Difficulty**: hiện suy từ `type` cho case generator gốc — nên gán tay theo
  semantic gap thực tế khi mở rộng.
- **Non-1024 embedding**: cần migration/DB riêng (xem §12).
