# Grounding & generation (PHASE 4 baseline · PHASE 7 rerank · PHASE 8 strict grounding)

## Vấn đề

Mục tiêu của hệ thống (PROMPT §2): _"LLM trả lời đúng khi có evidence và biết
từ chối khi không có"_. Retrieval kéo về chunk chưa đủ — còn phải:

- **không nhồi raw retrieval vào prompt** (trùng lặp, thứ tự sai, vượt token) —
  §21,
- **kiểm tra trước khi gọi LLM**: đủ evidence không? nếu không → abstain, KHÔNG
  tốn một lời gọi LLM — §22, §30,
- **ép LLM chỉ dùng context**, xuất structured output, **validate server-side**
  — §23, §50,
- không tạo citation giả — §29.

> **PHASE 4 là _baseline_ (§35)** — prompt grounding + structured output, chỉ
> abstain khi context rỗng. **PHASE 8** siết: ngưỡng relevance thật (strict),
> hậu kiểm answer↔context (hàm thuần), CONFLICTING_EVIDENCE, sinh lại 1 lần.
> Bật/tắt bằng `RAG_STRICT_GROUNDING` để mỗi cải tiến đo được (§36). Claim-level
> faithfulness = PHASE 10.

## Pipeline (`RagPipelineService`, §41)

```
query (+ strategy, rerank, strict)
  → RetrievalService.retrieve                     # P4 vector · P6 keyword/graph/hybrid/fusion
  → (RERANK_ENABLED) RerankerService.rerank       # P7
  → ContextBuilderService.build                   # dedup · sort · token budget
  → ContextValidatorService.validate(strict)      # §22
      ├─ proceed = false → abstain (KHÔNG gọi LLM), INSUFFICIENT_EVIDENCE
      └─ proceed = true  → AnswerGenerationService.generate(strict)  # + hậu kiểm P8
  → persist RagQuery { status, answer, provider, model, usage, trace, latencyMs }
  → response
```

Claim extraction / evidence matching / claim-level faithfulness / citation cấp
claim = PHASE 9-10. Hiện `claims: []`, `faithfulness: null`, `citations` map thô.

## ContextBuilder (`src/rag/context/context-builder.service.ts`, §21)

- **Dedup** theo `chunkId` — giữ bản có `score` cao nhất (cùng chunk có thể đến
  từ vector + graph khi fusion).
- **Sort** giảm dần theo `score`.
- **Token budget** `MAX_CONTEXT_TOKENS`: nhồi theo thứ tự relevance tới khi
  chạm trần; **luôn giữ ít nhất 1 chunk** kể cả khi chunk đầu đã vượt trần.
- **Render** cho prompt: mỗi chunk có nhãn `[i]` + breadcrumb nguồn
  `(Quy chế > Chương I > Điều 2, tr.3)`, ngăn nhau bằng `---`.

Output `GroundingContext { chunks, totalTokens, sources: [{documentId, chunkIds}] }`.

## ContextValidator (`src/rag/context/context-validator.service.ts`, §22, §30)

`validate(context, strict?) → { proceed, status, reason?, topScore, strict }`.

| Điều kiện abstain (`proceed = false`)     | Baseline           | Strict (PHASE 8)             |
| ---------------------------------------- | ------------------ | --------------------------- |
| số chunk < `RAG_MIN_CHUNKS`               | `= 1`              | như baseline                |
| topScore < `RAG_MIN_RELEVANCE`            | `= 0`              | max(baseline, ABSTAIN_MIN)  |
| topScore < `RAG_ABSTAIN_MIN_RELEVANCE`   | —                  | `= 0.15`                    |

→ baseline **chỉ abstain khi context rỗng** (cố ý — để hallucination rate đo được
§35). `RAG_STRICT_GROUNDING=true` (hoặc `strict: true` per-request) siết ngưỡng
relevance + bật hậu kiểm ở AnswerGeneration.

> **⚠️ `RAG_ABSTAIN_MIN_RELEVANCE` phụ thuộc thang điểm của bước cuối cùng
> trước validator.**
> `topScore` là `score` của chunk đầu — thang điểm KHÁC nhau theo pipeline:
>
> | Pipeline | Thang `topScore` | Chunk vô quan nằm quanh | Giá trị `ABSTAIN_MIN` hợp lý |
> | --- | --- | --- | --- |
> | vector-only (cosine) | `1 − distance/2` → trực giao ≈ **0.5** | 0.4 – 0.55 | **0.6 – 0.7** |
> | vector-only (l2/ip) | xem `retrieval.md` | — | hiệu chỉnh theo corpus |
> | có rerank (fake/llm) | `rerankScore` bắt đầu từ **0.0** | ~0.0 – 0.2 | **0.1 – 0.2** (mặc định 0.15) |
>
> Mặc định `0.15` được chọn cho pipeline **có rerank**. Vận hành **vector-only +
> strict** thì phải nâng `RAG_ABSTAIN_MIN_RELEVANCE` lên ~0.65, nếu không ngưỡng
> gần như không bao giờ chặn (mọi chunk cosine đều ≥ 0.4).

Khi abstain: trả câu cố định
_"Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi
này."_, status `INSUFFICIENT_EVIDENCE`, `citations: []` — **không gọi LLM**.

## AnswerGeneration (`src/rag/grounding/answer-generation.service.ts`, §23-25)

System prompt: chỉ dùng context, không kiến thức ngoài, không đoán, mọi khẳng
định truy được về một mục `[i]`; thiếu evidence → `INSUFFICIENT_EVIDENCE`; hai
nguồn mâu thuẫn → `CONFLICTING_EVIDENCE` + `conflictNote`; `groundedInContext`
= true CHỈ khi mọi câu có căn cứ nguyên văn.

`chatStructured(messages, GROUNDED_SCHEMA, { temperature: RAG_TEMPERATURE })`:

```ts
{
  answer: string,
  status: 'GROUNDED' | 'PARTIALLY_GROUNDED' | 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_EVIDENCE',
  usedContext: number[],            // chỉ số [i] LLM thực sự dùng
  groundedInContext: boolean,       // LLM tự khẳng định answer bám nguyên văn context
  conflictNote: string              // khi CONFLICTING_EVIDENCE
}
```

Output **luôn `schema.parse` server-side** (§50). `citedIndexes` = `usedContext`
lọc `[1, nContext]`, bỏ trùng, sắp tăng.

### Hậu kiểm grounding (PHASE 8, `grounding-checks.ts` — hàm thuần)

`resolveGroundingStatus` chạy trên output LLM (KHÔNG phải claim-level faithfulness
— đó là P10):

| Điều kiện | Kết quả | Áp dụng |
| --- | --- | --- |
| answer khớp mẫu abstention (`looksLikeAbstention`) | → `INSUFFICIENT_EVIDENCE` | cả non-strict |
| status GROUNDED/PARTIALLY nhưng `usedContext` rỗng | → `INSUFFICIENT_EVIDENCE` | cả non-strict |
| [strict] GROUNDED nhưng `groundedInContext = false` | → `PARTIALLY_GROUNDED` | strict |
| [strict] answer ≥ 5 token nội dung và `lexicalGroundingRatio(answer, context) < RAG_MIN_GROUNDING_RATIO` | GROUNDED→`PARTIALLY_GROUNDED` + **sinh lại 1 lần** (`RAG_REGENERATE_ON_UNGROUNDED`) | strict |

`looksLikeAbstention` chia 2 tầng để tránh phạt oan câu trả lời hợp lệ (_"Quy chế
không đề cập thời hạn"_ LÀ câu trả lời đúng):

- **STRONG** (_"không tìm thấy thông tin"_, _"không thể trả lời câu hỏi"_,
  _"tôi không biết"_, `insufficient_evidence`…) — match ở mọi độ dài.
- **WEAK** (_"không có thông tin"_, _"ngữ cảnh không đề cập"_…) — chỉ match khi
  answer **≤ 25 từ**, tức không kèm nội dung thực chất.

`lexicalGroundingRatio` = tỉ lệ token nội dung (bỏ stopword) của answer xuất hiện
trong context — proxy thô cho "answer dùng từ ngữ có trong ngữ cảnh". **Bỏ qua
khi answer < 5 token nội dung** (câu ngắn kiểu _"Hai học kỳ."_ cho ratio nhiễu
mạnh) và **không** dùng cho paraphrase-detection (diễn đạt lại hợp lệ nhưng ít
trùng từ vẫn có thể bị hạ xuống PARTIALLY — chấp nhận được vì chỉ hạ bậc, không
xoá answer). Claim-level faithfulness đúng nghĩa = P10.

`trace.generation` = **output thô của LLM TRƯỚC hậu kiểm pipeline**: `citedIndexes`
ở đây là `usedContext` LLM khai, giữ nguyên kể cả khi status bị hạ về
`INSUFFICIENT_EVIDENCE` (lúc đó `citations` cấp response = `[]`). Dùng để audit
"LLM đã nói gì" vs "pipeline quyết gì". `trace.generation` thêm `groundingRatio`,
`downgraded`, `regenerated`, `conflictNote`. Khi status bị hạ về
`INSUFFICIENT_EVIDENCE` → answer = câu abstain chuẩn + `citations: []`.

`temperature` mặc định 0 (`RAG_TEMPERATURE`) — grounded answer cần tất định.

## Trạng thái trả về

| status                  | Ý nghĩa                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `GROUNDED`             | trả lời đầy đủ, có căn cứ trong context                     |
| `PARTIALLY_GROUNDED`   | chỉ trả lời được một phần                                   |
| `INSUFFICIENT_EVIDENCE`| abstain (validator chặn, hoặc LLM tự nhận không đủ)         |
| `CONFLICTING_EVIDENCE` | (PHASE 8) LLM phát hiện hai nguồn mâu thuẫn về cùng một điều                                |
| `ERROR`                | lỗi hạ tầng (LLM down...) — response **200** kèm `error`, không 500; `RagQuery.error` được ghi, chạy lại được |

## Citations (baseline — §29)

PHASE 4: map trực tiếp `usedContext[i]` → chunk thứ i trong context → document.
`Citation { documentId, chunkId, page, section, valid: true }` khi LLM có nêu
chỉ số và chỉ số hợp lệ. **Chưa xác minh claim** (PHASE 8-9): chưa tách answer
thành claim, chưa đối chiếu từng claim với chunk. `claimId`/`claimText` rỗng.

Không map được chỉ số nào → không có citation (không bịa — §29).

## Observability (§38, §56)

Mỗi truy vấn ghi `RagQuery`:
`{ query, status, answer, provider, model, usage: {inputTokens, outputTokens, embeddingTokens, estimatedCost}, trace: {retrieval, context, validation, generation}, latencyMs, error? }`
+ `RetrievalLog` liên kết qua `ragQueryId`.

## Benchmark

- **Experiment 004 (PHASE 8)** — `POST /evaluation/benchmark-grounding`: strict
  off → on. So abstentionAccuracy / hallucinationRateProxy / answerCorrectness /
  passRate + avgLatencyMs / totalCost. Kỳ vọng: hallucination giảm, latency+cost
  tăng nhẹ (regenerate). Bật strict chỉ khi delta đủ lớn.
  > **Cần LLM thật.** `FakeLlmProvider` luôn trả `status = GROUNDED` +
  > `groundedInContext = true` (trích xuất câu, không biết abstain) → chạy
  > benchmark-grounding với `LLM_PROVIDER=fake` cho delta ≈ 0 ở mọi metric. Đó
  > KHÔNG phải bug — chỉ là mock tất định; strict grounding chỉ có tác dụng đo
  > được với provider thật. E2E dùng fake chỉ kiểm smoke đường đi.
- **Experiment 005 (P10)** — no verifier vs Faithfulness verifier claim-level.
- Baseline (§35): lưu `EvaluationRun.isBaseline = true` — mọi run sau so với nó.
