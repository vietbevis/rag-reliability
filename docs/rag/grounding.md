# Grounding & generation (PHASE 4 baseline; siết chặt ở PHASE 7-9)

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

> **PHASE 4 là _baseline_ (§35).** Prompt yêu cầu grounding nhưng chưa có claim
> extraction, evidence matching, contradiction detection, abstention nghiêm
> ngặt. Đó là PHASE 7-9. Baseline tồn tại để **đo** hallucination rate ban đầu
> rồi chứng minh từng cải tiến bằng số (Experiment 004: Basic vs Grounded
> prompt; 005: no-verifier vs Faithfulness verifier).

## Pipeline (`RagPipelineService`, §41)

```
query
  → RetrievalService.retrieve (vector)           # PHASE 4; keyword/graph/fusion ở P6
  → ContextBuilderService.build                  # dedup · sort · token budget
  → ContextValidatorService.validate             # §22
      ├─ proceed = false → abstain (KHÔNG gọi LLM), status INSUFFICIENT_EVIDENCE
      └─ proceed = true  → AnswerGenerationService.generate
  → persist RagQuery { status, answer, provider, model, usage, trace, latencyMs }
  → response
```

Reranking (P7), claim extraction / evidence matching / faithfulness / citation
cấp claim (P8-9) chèn vào giữa `generate` và `response`. Hiện `claims: []`,
`faithfulness: null`, `citations` là map thô (xem dưới).

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

`validate(context) → { proceed, status, reason?, topScore }`.

| Điều kiện abstain (`proceed = false`)              | Baseline mặc định          |
| ------------------------------------------------- | ------------------------- |
| số chunk < `RAG_MIN_CHUNKS`                        | `RAG_MIN_CHUNKS = 1`      |
| điểm chunk tốt nhất < `RAG_MIN_RELEVANCE`          | `RAG_MIN_RELEVANCE = 0`   |

→ mặc định **chỉ abstain khi context rỗng**. Cố ý: baseline phải để LLM thử
trả lời để hallucination rate đo được (§35). PHASE 7 nâng
`RAG_MIN_RELEVANCE`, thêm phát hiện conflicting-evidence, và abstention dựa
trên faithfulness verifier.

Khi abstain: trả câu cố định
_"Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi
này."_, status `INSUFFICIENT_EVIDENCE`, `citations: []` — **không gọi LLM**.

## AnswerGeneration (`src/rag/grounding/answer-generation.service.ts`, §23)

System prompt (baseline) yêu cầu: chỉ dùng context, không kiến thức ngoài,
không đoán, mọi khẳng định có căn cứ, thiếu evidence thì
`status = INSUFFICIENT_EVIDENCE`, không tạo trích dẫn giả.

`LlmService.chatStructured(messages, BASELINE_SCHEMA, { temperature: RAG_TEMPERATURE })`
với schema Zod:

```ts
{
  answer: string,
  status: 'GROUNDED' | 'PARTIALLY_GROUNDED' | 'INSUFFICIENT_EVIDENCE',
  usedContext: number[]   // chỉ số [i] LLM thực sự dùng, default []
}
```

Output **luôn `schema.parse` server-side** (§50 — không tin việc provider tự ép
schema). `citedIndexes` = `usedContext` lọc về khoảng hợp lệ `[1, nContext]`,
bỏ trùng, sắp tăng.

`temperature` mặc định 0 (`RAG_TEMPERATURE`) — grounded answer cần tất định.

## Trạng thái trả về

| status                  | Ý nghĩa                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `GROUNDED`             | trả lời đầy đủ, có căn cứ trong context                     |
| `PARTIALLY_GROUNDED`   | chỉ trả lời được một phần                                   |
| `INSUFFICIENT_EVIDENCE`| abstain (validator chặn, hoặc LLM tự nhận không đủ)         |
| `CONFLICTING_EVIDENCE` | (PHASE 9) hai nguồn mâu thuẫn                                |
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

- **Experiment 004** — Basic prompt vs Grounded prompt: cùng retrieval, đổi
  system prompt, so Faithfulness / Hallucination Rate / Answer Correctness.
- **Experiment 005** — no verifier vs Faithfulness verifier (P9): đo verifier
  bắt được bao nhiêu % câu trả lời không grounded.
- Baseline (§35): lưu `EvaluationRun.isBaseline = true` — mọi run sau so với nó.
