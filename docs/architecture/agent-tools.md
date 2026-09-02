# Tool Calling & Agent Orchestration (PHASE 17)

> Mở rộng RAG pipeline một chiều thành một **agent read-first, có kiểm soát**:
> nhận task ngôn ngữ tự nhiên → tự chọn & gọi tool nhiều bước → tổng hợp câu
> trả lời **grounded + có citation**, hoặc **abstain**. Tài liệu này là plan
> chốt để triển khai; cập nhật khi từng bước hoàn thành.

---

## 1. Triết lý

Agent **kế thừa nguyên** triết lý reliability của service (xem
`rag-architecture.md §1`). Không có ngoại lệ nào chỉ vì "giờ là agent":

1. **Kết thúc hợp lệ chỉ có 2 dạng**: `GROUNDED` / `PARTIALLY_GROUNDED` kèm
   citations, hoặc `INSUFFICIENT_EVIDENCE`. Agent **không bao giờ** kết thúc
   bằng câu trả lời không có evidence.
2. **Output của tool là dữ liệu KHÔNG tin cậy** — không bao giờ được diễn giải
   như chỉ thị (chống prompt injection qua tool result). `finalize` không để
   nội dung tool output định đoạt `status`.
3. **Mọi vòng lặp bị chặn cứng**: số bước, số tool call, token, thời gian, chi
   phí. Không đường nào chạy vô hạn (PROMPT §52).
4. **v1 chỉ read-only.** Tool có side-effect để phase sau (17.11), luôn qua
   human approval.
5. Business logic quan trọng (chọn tool cuối, kiểm chứng câu trả lời) **được
   kiểm soát trực tiếp**; LangGraph chỉ là máy trạng thái, không phải black box
   (PROMPT §3.1, §49).
6. Mọi tối ưu phải chứng minh bằng số (baseline → experiment → regression) —
   như phần RAG.

---

## 2. Trạng thái theo bước

| Bước  | Nội dung                                                                                                                                   | Trạng thái  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 17.0  | Config nhóm `agent` (env.schema/configuration) · `AgentModule` rỗng wired · flag `AGENT_ENABLED=false`                                     | ✅ Xong     |
| 17.1  | `LLMProvider.chatWithTools` + `supportsNativeToolCalling` + role `'tool'` · impl `BaseLangChainLlmProvider` · `fake-llm` scriptable · test | ✅ Xong — native tool-calling verify LIVE với api.b.ai (deepseek-v4-flash): 4/4 e2e pass |
| 17.2  | `tool.interface` + `tool-registry` + `calculator` + `current_time`                                                                         | ✅ Xong — `mathjs` hardened; registry validate snake_case/unique/read-only + resolve theo allowlist |
| 17.3  | `agent-state` + `agent-graph.builder` + `agent.node` + `tool.node` + `budget.guard` + `loop-detector` (chưa verify, trả raw)               | ✅ Xong — LangGraph StateGraph, vòng `agent ⇄ tool`, guard budget/loop/no-progress; verify LIVE api.b.ai 2/2 e2e |
| 17.4  | `rag_search` (bọc `RetrievalService`; param `strategy` gồm cả `graph` — gộp `graph_query` vào)                                             | ✅ Xong — 7 unit test; tool.node cộng dồn cost tool vào usage |
| 17.5  | `finalize.node` + `AnswerVerificationService` (dùng chung với RAG) · map `RagStatus` · abstain path · `AgentCitation.kind` (chunk/graph/computation) | ✅ Xong — 20 unit test; **§9.3 numeric-provenance check chưa làm** (số có dấu phân cách lexical-match trượt) |
| 17.6  | Prisma `AgentRun` + `AgentStep` + migration · persist trajectory · `AgentService`                                                          | ✅ Xong — migration `phase17_agent_run` (đã tỉa DROP INDEX drift); e2e round-trip pass |
| 17.7  | `agent.controller` (sync) + rate limit + DTO + Swagger                                                                                     | ✅ Xong — `AgentEnabledGuard` gate `AGENT_ENABLED`; throttler `agent` (10/phút); e2e HTTP 4/4 |
| 17.8  | Async BullMQ + SSE stream + cancel · ~~Postgres checkpointer~~ hoãn                                                                        | ✅ Xong (trừ checkpointer) — e2e async 202→worker + fallback sync + cancel 409 + SSE |
| 17.9  | Langfuse `LangfuseTracer` (SDK v3, best-effort) + config + wiring + doc                                                                     | ✅ Xong — không dùng callback handler (peer LangChain lệch); self-host để user chạy compose upstream |
| 17.10 | Eval agent trên **promptfoo** + `agent-metrics` + golden dataset + `npm run evaluate:agent`                                               | ✅ Xong (infra) — seed run cho thấy deepseek-v4-flash **hay bỏ qua tool** (task "dùng calculator" → 0 tool call). Baseline để cải thiện ở 17.11. |
| 17.11 | _(sau)_ `web_search` (Tavily + SSRF guard) · write-tool + HITL approval (`/approve`)                                                       | ⬜ Backlog  |

---

## 3. Quyết định kiến trúc đã chốt

### 3.1. Mặc định

| #   | Quyết định          | Chốt                                                                                                                                                                  |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Phạm vi tool v1     | **Read-only**: `rag_search`, `graph_query`, `calculator`, `current_time`. Tool ghi + human approval → 17.11.                                                          |
| 2   | Thực thi API        | **Async (BullMQ)** mặc định + cho phép `execution:'sync'` với task ngắn + SSE stream tiến trình.                                                                      |
| 3   | Model vòng agent    | Backend LLM đang dùng là **custom provider bên thứ 3** (API OpenAI-compatible). Tool-calling native là đường chính; `AGENT_MODEL` (tuỳ chọn) ghi đè model cho riêng vòng agent. **Fallback constrained-JSON** giữ làm lưới an toàn khi `supportsNativeToolCalling()=false`. |
| 4   | `rag_search` trả về | **Chunk thô** (không generate ở tool) — agent tự tổng hợp ở `finalize`. Rẻ, ít vòng LLM.                                                                              |
| 5   | Checkpointer        | **HOÃN.** `@langchain/langgraph-checkpoint-postgres` cần peer `@langchain/langgraph-checkpoint@^1.1.4` (rủi ro lệch với langgraph 1.4). v1 read-only KHÔNG có `interrupt()` nên checkpointer chỉ có giá trị crash-resume; SSE `/stream` poll DB (không cần checkpointer). Làm khi có HITL / write-tool (17.11). |
| 6   | `web_search`        | Hoãn tới 17.11 (cần API key + SSRF guard).                                                                                                                            |

### 3.2. Thư viện OSS đưa vào — và vì sao KHÔNG dùng framework trọn gói

Đã khảo sát hệ OSS TypeScript 2026 (Mastra, VoltAgent, Vercel AI SDK, OpenAI
Agents SDK JS, LangGraph). **Không có repo nào cắm-vào-là-chạy** cho bài toán
"RAG agent production có abstention + faithfulness" — phần khó nhất
(grounding/citation/faithfulness/abstain) service này **đã tự làm rồi** và
không framework nào thay được.

| Lớp                             | Chọn                                                                                                 | Lý do                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestration                   | **`@langchain/langgraph`** (đã có trong `package.json`)                                              | Lựa chọn OSS trưởng thành nhất cho vòng agent có kiểm soát trong TS: checkpoint, streaming, `interrupt()`, resume. Đúng PROMPT §3.1/§49.            |
| Observability                   | **Langfuse** (self-host, MIT)                                                                        | Trace trajectory + cost + prompt versioning, callback handler sẵn cho LangChain/LangGraph. Thay "LangSmith optional" + rút ngắn việc OTel thủ công. |
| Đánh giá agent                  | **promptfoo** (MIT, Node-native)                                                                     | Agent eval + so trajectory + red-team prompt-injection, chạy CI, hỗ trợ provider custom/Ollama. Thay việc tự code toàn bộ metric.                   |
| Chuẩn hoá tool-call đa provider | _(tuỳ chọn)_ **Vercel AI SDK** (`ai`) chỉ dùng `generateText`/`streamText` bên trong `chatWithTools` | Dùng khi tự parse `tool_calls` mỗi provider bị rối. **Không** dùng làm framework agent.                                                             |
| Second-opinion faithfulness     | _(backlog)_ **Patronus Lynx** (open model, chạy Ollama)                                              | Tín hiệu thứ 2 cho `finalize` bên cạnh LLM-judge. Không bắt buộc.                                                                                   |

**KHÔNG đưa vào**: Mastra / OpenAI Agents SDK làm framework chính (muốn "sở
hữu" app, xung đột với `LLMProvider` abstraction + module grounding sẵn có);
`AgentExecutor` legacy của LangChain (deprecated); framework multi-agent
(crew/autogen-style); workflow engine tổng quát; "auto-GPT". Đúng PROMPT §49.

---

## 4. Kiến trúc module

```
src/agent/
  agent.module.ts
  agent.controller.ts        # POST /agent/run · GET /agent/runs/:id · .../trace · .../stream · .../cancel
  agent.service.ts           # tạo AgentRun · chạy graph · persist
  graph/
    agent-graph.builder.ts   # LangGraph StateGraph — node + edge
    agent-state.ts           # kiểu state (Annotation) + reducer
    nodes/
      plan.node.ts           # (tuỳ chọn) phân rã task → sub-goals
      agent.node.ts          # LLM + bindTools → chọn tool nào / trả lời thẳng
      tool.node.ts           # thực thi tool call · đóng gói kết quả + evidence
      finalize.node.ts       # ép grounding + citation + faithfulness lên câu trả lời cuối
    guards/
      budget.guard.ts        # step / token / time / cost caps
      loop-detector.ts       # phát hiện gọi lặp cùng tool + input
  tools/
    tool.interface.ts        # AgentTool<TInput, TOutput>
    tool-registry.service.ts # đăng ký + resolve theo allowlist
    rag-search.tool.ts       # bọc RetrievalService (chunk thô)
    graph-query.tool.ts      # bọc GraphQueryService
    calculator.tool.ts       # mathjs · deterministic
    current-time.tool.ts     # khử phi-xác định
  dto/run-agent.dto.ts
  agent.types.ts
```

Tái dùng (không sửa): `src/ai/llm/*`, `src/common/errors`, `src/common/utils`
(`withRetry`/`withTimeout`/`sleep` — generalize từ `src/ai/llm/retry.util.ts`),
`src/common/observability/trace-sanitizer.util.ts`, module
`rag/retrieval` · `rag/context` · `rag/grounding`.

### Luồng graph

```mermaid
flowchart TD
  START --> PLAN[plan]
  PLAN --> AGENT[agent: LLM + bindTools]
  AGENT -->|tool_calls?| TOOL[tool: execute + evidence]
  TOOL --> AGENT
  AGENT -->|final answer / no tool| FIN[finalize: grounding + citation + faithfulness]
  AGENT -->|guard fail: budget/loop| FIN
  FIN --> END
```

Dùng **custom `StateGraph`**, KHÔNG dùng `createReactAgent` prebuilt — cần chèn
guard giữa mỗi vòng, kiểm soát định dạng tool-call cho model local, và **bắt
buộc** đi qua `finalize` (verify). Prebuilt không đảm bảo điều này.

---

## 5. Lớp tool

```ts
export interface AgentToolContext {
  agentRunId: string;
  signal: AbortSignal; // guard hủy tool đang chạy
  logger: Logger;
}

export interface ToolEvidence {
  kind: 'chunk' | 'graph' | 'computation';
  ref: string; // chunkId / entityId / biểu thức
  text: string; // văn bản hoá để finalize verify
}

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  data: T; // đã validate bằng outputSchema
  evidence: ToolEvidence[];
  usage?: TokenUsage; // nếu tool gọi LLM
  truncated?: boolean;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly name: string; // snake_case, ổn định
  readonly description: string; // prompt-facing — nói rõ KHI NÀO dùng
  readonly inputSchema: ZodType<TInput>;
  readonly outputSchema: ZodType<TOutput>;
  readonly access: 'read' | 'write'; // v1 chỉ 'read'
  readonly timeoutMs: number;
  readonly maxRetries: number;
  execute(
    input: TInput,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult<TOutput>>;
}
```

- **Registry** đăng ký tool qua DI (token `AGENT_TOOLS`), resolve theo
  `toolAllowlist` của request (mặc định = tất cả read tool).
- Mỗi tool call chạy qua `withTimeout(withRetry(...))`.
- **Kết quả trả về agent bị cắt** (`AGENT_TOOL_RESULT_MAX_TOKENS`) + cờ
  `truncated`; toàn văn lưu `AgentStep.toolOutput` cho audit.
- Schema Zod định nghĩa **một lần**, expose cho LLM qua `zodToJsonSchema` /
  LangChain `tool()` — không viết 2 lần.

---

## 6. Tool-calling trong lớp LLM

Mở rộng `LLMProvider` (`src/ai/llm/llm.interface.ts`) — giữ provider-agnostic,
giữ retry / timeout / cost accounting:

```ts
export interface ToolSpec {
  name: string;
  description: string;
  parameters: ZodType<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface LLMToolResponse extends LLMResponse {
  toolCalls: ToolCall[]; // rỗng ⇒ model muốn trả lời thẳng
}

interface LLMProvider {
  // ...hiện có...
  supportsNativeToolCalling(): boolean;
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolSpec[],
    options?: LLMOptions,
  ): Promise<LLMToolResponse>;
}
```

- `BaseLangChainLlmProvider.chatWithTools` = `model.bindTools(...).invoke(...)`,
  parse `response.tool_calls`, **validate `args` bằng Zod của tool** trước khi
  trả (không tin output thô — PROMPT §50).
- `ChatMessage` thêm role `'tool'` (`{ role:'tool', toolCallId, content }`);
  assistant message mang `toolCalls` để dựng lại lịch sử nhiều vòng.
- **Fallback**: `supportsNativeToolCalling()=false` → dùng `chatStructured` với
  schema `{ action:'call_tool'|'final', tool?, args?, answer? }`. `agent.node`
  xử lý cả 2 đường qua cùng kiểu `LLMToolResponse`.
- `fake-llm.provider` thêm khả năng script tool-call cho unit test.
- _(tuỳ chọn)_ impl `chatWithTools` gọi Vercel AI SDK `generateText` bên trong
  nếu việc chuẩn hoá `tool_calls` giữa Ollama/OpenAI/Anthropic quá rối.

---

## 7. Bộ tool v1

| Tool           | Bọc gì                                                                               | Ghi chú                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_search`   | `RetrievalService`                                                                  | Cốt lõi. Param `strategy` ∈ vector/keyword/graph/hybrid — **`graph` thay cho tool `graph_query` riêng** (retrieval layer đã route). Trả **chunk thô** + score + ids → evidence `kind:'chunk'` (hoặc `'graph'` nếu source=graph). Không generate. Lỗi hạ tầng ⇒ `ok:false` (§54). |
| `calculator`   | `mathjs` (hardened: bắt ref `evaluate` trước khi vô hiệu `import`/`createUnit`/…)    | Deterministic, không LLM. Sửa lỗi số học của model.                                                                                                        |
| `current_time` | `Date` + `Intl`                                                                     | Khử phi-xác định cho câu hỏi "gần đây / hôm nay".                                                                                                          |

Không vào v1: tool ghi DB, HTTP tùy ý, `web_search`, code execution.

---

## 8. Vòng lặp & guardrails

Config mới nhóm `agent` (`src/config/env.schema.ts` + `configuration.ts`):

```
AGENT_ENABLED=false
AGENT_MAX_STEPS=8
AGENT_MAX_TOOL_CALLS=12
AGENT_MAX_WALL_CLOCK_MS=120000
AGENT_MAX_TOTAL_TOKENS=60000
AGENT_COST_BUDGET_USD=0.10
AGENT_TOOL_RESULT_MAX_TOKENS=2000
AGENT_LOOP_REPEAT_THRESHOLD=2
AGENT_MODEL=                     # pin model hỗ trợ tool tốt (Qwen2.5 / Llama 3.1+)
AGENT_EXECUTION=async            # async | sync
```

- **`budget.guard`** chạy trước mỗi vòng `agent`→`tool`: vượt bất kỳ cap nào →
  nhảy thẳng `finalize` với cờ `forcedStop` (tổng hợp từ evidence đã có, hoặc
  abstain — **không** để lỗi lộ ra như "câu trả lời").
- **`loop-detector`**: hash `(toolName + normalize(args))`; lặp ≥
  `AGENT_LOOP_REPEAT_THRESHOLD` → chặn tool đó + thêm system note "input này đã
  chạy rồi, dùng kết quả cũ hoặc đổi hướng"; không tiến triển toàn cục →
  `finalize`.
- **No-progress**: N vòng liên tiếp không có evidence mới → `finalize`.
- **Cancel**: `AbortController` xuyên xuống `ctx.signal` của tool và `signal`
  của LLM.
- v1 **không** có nhánh approval / interrupt (không có write tool).

---

## 9. Kiểm chứng câu trả lời cuối (`finalize.node`)

Tái dùng nguyên module grounding hiện có (xem `grounding.md`, `faithfulness.md`,
`citation.md`):

1. Gom toàn bộ `evidence` từ mọi `tool_result` trong run (chunks + graph +
   computation).
2. `AnswerGenerationService.generate(task, contextTừEvidence)` — hoặc nếu agent
   đã soạn câu trả lời, chạy qua verify path.
3. `ClaimExtractorService` → `EvidenceMatcherService` → `FaithfulnessService`
   (như `RagPipelineService.runCitation` + faithfulness verifier).
4. Map `RagStatus`: claim không có evidence → `PARTIALLY_GROUNDED`; mâu thuẫn →
   `CONFLICTING_EVIDENCE`; không có evidence nào → `INSUFFICIENT_EVIDENCE` +
   câu abstain chuẩn.
5. Evidence `kind:'computation'` cite riêng (mở rộng `Citation.kind`), **không**
   tính vào grounding ratio của KB.

Kết quả: `AgentRunResult` có cùng shape "reliability" như `RagQueryResult`
(answer, status, citations, claims, faithfulness) + trajectory.

**Đã làm (17.5):** `src/rag/grounding/answer-verification.service.ts` đóng gói
chuỗi verify (`verifyAnswer` cho câu agent tự soạn · `synthesizeAndVerify` cho
đường dừng sớm), export cho cả `finalize.node` và (về sau) `RagPipelineService`.
`finalize.node` dựng chunk giả từ evidence `computation`, relabel citation →
`AgentCitation.kind` (chunk/graph/computation) — KHÔNG đụng `CitationKind` gốc
của RAG.

**Chưa làm — §9.3 numeric-provenance:** claim về số liệu tính được chỉ verify
qua lexical match + faithfulness LLM; số có dấu phân cách ("684.500" vs
"684500") làm lexical trượt, LLM thì thận trọng → dễ hạ `INSUFFICIENT_EVIDENCE`
oan. Cần bước riêng: trích mọi số trong answer, đối chiếu xuất hiện trong
evidence `computation`. **Ứng viên phải làm trước khi coi agent production-ready.**

---

## 10. Persistence

Prisma models mới (`prisma/schema.prisma`):

```prisma
enum AgentRunStatus { RUNNING COMPLETED ABSTAINED FAILED CANCELLED }
enum AgentStepType  { THINK TOOL_CALL TOOL_RESULT FINAL GUARD_STOP }

model AgentRun {
  id            String         @id @default(cuid())
  task          String
  status        AgentRunStatus
  finalStatus   RagStatus?                 // tái dùng enum
  answer        String?
  toolAllowlist String[]
  costBudgetUsd Float
  usage         Json                       // {inputTokens, outputTokens, embeddingTokens, estimatedCost}
  latencyMs     Int?
  stepCount     Int            @default(0)
  toolSetHash   String?
  trace         Json?                      // sanitize qua trace-sanitizer
  checkpointId  String?
  error         String?
  steps         AgentStep[]
  createdAt     DateTime       @default(now())
}

model AgentStep {
  id         String        @id @default(cuid())
  agentRunId String
  agentRun   AgentRun      @relation(fields: [agentRunId], references: [id], onDelete: Cascade)
  index      Int
  type       AgentStepType
  toolName   String?
  toolInput  Json?
  toolOutput Json?                          // toàn văn (chưa cắt)
  evidence   Json?
  tokens     Json?
  latencyMs  Int?
  error      String?
  createdAt  DateTime      @default(now())

  @@unique([agentRunId, index])
}
```

Checkpointer của LangGraph dùng bảng riêng (prefix `lg_`), tạo bởi
`@langchain/langgraph-checkpoint-postgres`.

---

## 11. Observability — Langfuse (17.9)

- **`LangfuseTracer`** (`src/agent/observability/`) ghi mỗi agent run thành 1
  trace (input=task, output=answer, tags status/final/stop) + 1 span / step
  (tool input/output, latency, error). **Best-effort**: Langfuse chết / chưa
  cấu hình ⇒ no-op, KHÔNG làm hỏng run. `AgentService.execute` gọi
  fire-and-forget sau khi persist.
- Dùng SDK **`langfuse` v3** (REST thuần) — KHÔNG dùng `langfuse-langchain`
  (kẹt peer `langchain <0.4`) hay `@langfuse/langchain` 5.x (cần OTel NodeSDK).
  Đổi lại: span do ta tự phát theo `AgentStepRecord`, không bắt được nội bộ
  LangChain — đủ để debug trajectory agent.
- Env: `LANGFUSE_ENABLED=false` (mặc định) · `LANGFUSE_HOST` ·
  `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (bắt buộc khi bật — validate ở
  `env.schema`).
- **Self-host**: Langfuse v3 cần stack riêng (postgres + clickhouse + redis +
  minio). Không nhồi vào `docker-compose.yml` của service này — chạy
  `docker compose` của [langfuse/langfuse](https://github.com/langfuse/langfuse)
  (hoặc Langfuse Cloud), rồi trỏ `LANGFUSE_HOST` + tạo project lấy key.
- **`AgentRun.trace`** trong Postgres (qua `trace-sanitizer`) vẫn là nguồn sự
  thật — query được kể cả khi Langfuse tắt.
- **SSE stream** `GET /agent/runs/:id/stream`: poll DB, đẩy `AgentStep` khi
  phát sinh, đóng khi run kết thúc.
- OpenTelemetry spans: để sau, chỉ thêm khi cần ghép APM chung.

---

## 12. Evaluation — promptfoo (17.10)

- **`npm run evaluate:agent`** = `nest build && promptfoo eval -c
  evaluation/agent/promptfooconfig.yaml`.
- **Custom provider** `evaluation/agent/provider.mjs` → `build-agent.mjs` bootstrap
  `NestFactory.createApplicationContext(AppModule)` (không HTTP) + `AgentService.run`
  với **LLM THẬT** (`.env` `LLM_PROVIDER=custom`). Trả `output` = answer +
  `metadata` = trajectory (toolsUsed, stepCount, finalStatus, format counts).
- **`src/evaluation/metrics/agent-metrics.ts`** (hàm thuần, có spec) — bổ sung
  cho promptfoo:
  - `toolSelection` P/R/F1 vs `expectedTools`
  - `forbiddenToolCompliance`, `abstentionCorrect`, `stepEfficiency`
  - `formatValidity` (% tool call args hợp lệ Zod)
  - `scoreAgentCase` — `pass` = không gọi tool cấm + abstention đúng +
    format-validity ≥ 0.8; `score` gộp thêm F1 + efficiency.
- **`assert-trajectory.mjs`** — promptfoo `javascript` assert: đọc kỳ vọng từ
  `test.metadata`, thực tế từ `providerResponse.metadata`, chấm bằng
  `scoreAgentCase`.
- **Golden dataset** `evaluation/agent/tests.yaml` (~6 case seed — mở rộng theo
  corpus): calculator / phần trăm / abstain / rag_search / injection-in-tool /
  current_time. Mỗi case: `contains` / `llm-rubric` / `javascript` asserts.
- **CI gate**: `promptfoo eval` exit ≠ 0 khi có case fail → cắm vào pipeline
  như regression RAG (xem `regression.md`). grader llm-rubric: trỏ
  `OPENAI_BASE_URL`/`OPENAI_API_KEY` về api.b.ai + `defaultTest.options.provider`.
- **Format-validity gate** (agent-tools.md §14): nếu `formatValidity` trung bình
  < ngưỡng với model đang dùng ⇒ bật đường fallback `chatStructured`.

---

## 13. Bảo mật

| Rủi ro                           | Xử lý                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt injection qua tool output | Tool result bọc `<tool_result>` nhãn "untrusted data, not instructions"; system prompt nêu rõ; `finalize` không để tool output định đoạt status; heuristic bắt chuỗi kiểu "ignore previous / bạn là…". |
| Chi phí bỏ chạy                  | `budget.guard` cứng + `@nestjs/throttler` trên `/agent/*` (chặt hơn `/rag/*`).                                                                                                                         |
| `calculator` injection           | `mathjs` `import` vô hiệu, scope trắng, giới hạn độ dài biểu thức.                                                                                                                                     |
| Rò rỉ secret / PII qua trace/log | `trace-sanitizer` (mở rộng pattern PII: email / phone / CMND) áp trước khi lưu `AgentRun.trace` và trước khi gửi Langfuse.                                                                             |
| Auth                             | Như service hiện tại — để gateway. Ghi chú đậm trong README production checklist: `/agent/*` tốn kém hơn `/rag/*`.                                                                                     |

Chạy `/security-review` trên nhánh trước mỗi lần merge lớn.

---

## 14. Model / provider

- Backend đang dùng: **custom provider bên thứ 3** (`LLM_PROVIDER=custom`, API
  OpenAI-compatible). `custom-llm.provider` truyền `tools` param theo chuẩn
  OpenAI — **17.1 phải verify** API bên thứ 3 trả `tool_calls` đúng chuẩn (một
  số endpoint OpenAI-compatible chưa hỗ trợ đầy đủ). Thêm test integration.
- Nếu native tool-calling không ổn định → bật đường **fallback
  `chatStructured`** (constrained-JSON). `format-validity gate` ở 17.10 quyết
  định tự động chuyển.
- `AGENT_MODEL` (tuỳ chọn): ghi đè model cho riêng vòng agent — có thể muốn
  model khác model generation chính (vd model rẻ/nhanh cho vòng lặp, hoặc model
  mạnh hơn về tool-calling).
- `reasoning:false` cho `agent.node` (cờ đã có trong `LLMOptions`) — vòng agent
  cần nhanh, không cần thinking block dài.
- Tham khảo: tool-calling model OSS 2026 đạt ~70–80% chính xác vs 95%+ model
  thương mại — giữ fallback + gate bất kể backend nào.

---

## 15. API surface

```
POST /agent/run
  body: { task, toolAllowlist?, costBudgetUsd?, execution?: 'sync'|'async' }
  → async: 202 { id, status: 'RUNNING' }
  → sync : 200 AgentRunResult

GET  /agent/runs/:id            → AgentRunResult (answer, finalStatus, citations, claims, usage, latency)
GET  /agent/runs/:id/trace      → trajectory sanitized
GET  /agent/runs/:id/stream     → SSE step events
POST /agent/runs/:id/cancel     → abort
```

Async qua **BullMQ** (queue đã có): queue `agent-run`, worker gọi
`AgentService.execute`. Task ngắn dùng `execution:'sync'`.

---

## 16. Thư viện

**Thêm mới:**

| Thư viện                                   | Vai trò                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `@langchain/langgraph-checkpoint-postgres` | Durable checkpoint cho async / resume                     |
| `mathjs`                                   | `calculator` an toàn, deterministic                       |
| `langfuse` + `langfuse-langchain`          | Observability self-host (callback handler)                |
| `promptfoo` _(devDep)_                     | Eval agent + red-team + CI gate                           |
| `ai` _(tuỳ chọn)_                          | Chuẩn hoá tool-call đa provider bên trong `chatWithTools` |

**Tái dùng (không phải dep mới):** `@langchain/langgraph` + `@langchain/core`
`tool()` + `zod` (đã có) · `withRetry`/`withTimeout` · `@nestjs/bullmq` ·
`@nestjs/throttler` · `trace-sanitizer` · module grounding/citation/faithfulness.

**KHÔNG thêm:** framework multi-agent · `AgentExecutor` legacy · workflow engine
tổng quát · Mastra/OpenAI-Agents làm framework chính · code execution.

---

## 17. Kế hoạch triển khai

Mỗi bước: comment tiếng Việt, TypeScript strict (không `any`), không disable
ESLint, có `.spec.ts`. Thứ tự = bảng §2.

- **17.0** → build + typecheck xanh, module wired.
- **17.1** → tool-call round-trip qua `fake-llm` + `custom` provider (test).
- **17.2** → 2 builtin tool + allowlist resolve (test).
- **17.3** → agent chạy vòng lặp với 2 tool, guard chặn đúng (budget + loop).
- **17.4** → agent trả lời câu hỏi KB qua `rag_search` / `graph_query`.
- **17.5** → `AgentRunResult` shape reliability đầy đủ + abstain path.
- **17.6** → run được lưu + query lại; migration áp sạch.
- **17.7** → e2e sync run qua HTTP.
- **17.8** → e2e async + SSE stream + cancel; checkpoint resume.
- **17.9** → trace Langfuse đủ để debug; README cập nhật.
- **17.10** → `npm run evaluate:agent` chạy, baseline chốt, CI gate.
- **17.11** _(sau)_ → `web_search` + write-tool + HITL.

---

## 18. Rủi ro & câu hỏi mở

| Rủi ro                                                       | Giảm thiểu                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Model local chọn sai tool / sai định dạng args               | format-validity gate (17.10) + fallback JSON; nếu vẫn kém → cân nhắc `AGENT_MODEL` thương mại cho riêng vòng agent. |
| **deepseek-v4-flash bỏ qua tool** — 17.10 seed eval: task ép "dùng công cụ tính toán" nhưng model vẫn trả lời thẳng, 0 tool call → finalize abstain. Tool-calling native của model này KHÔNG đáng tin cho ép-buộc dùng tool. | **17.11**: (a) system prompt mạnh hơn ("PHẢI gọi tool khi task yêu cầu"); (b) `tool_choice:'required'`/`'auto'` param nếu api.b.ai hỗ trợ; (c) đường fallback `chatStructured` (bắt buộc chọn action); (d) `AGENT_MODEL` khác. Đo lại bằng `evaluate:agent`. |
| ~~`reasoning: false` bị api.b.ai từ chối~~ — phát hiện 17.1, **đã fix**: bỏ `reasoning_effort:'none'` khỏi `NO_REASONING_KWARGS`, chỉ còn `enable_thinking:false`. Verify LIVE 5/5 e2e. | ✅ Xong (commit `fix(llm)`). `agent.node` dùng `reasoning:false` an toàn. |
| Vòng lặp tốn kém âm thầm                                     | `budget.guard` + `loop-detector` + Langfuse cost dashboard + rate limit theo run.                                   |
| `finalize` verify (nhiều LLM call) làm latency agent cao     | Cho phép tắt từng lớp verify qua request flag như `/rag/query` (`cite`, `faithfulness`); đo p50–p95 ở 17.10.        |
| Trùng lặp logic giữa `RagPipelineService` và `finalize.node` | Trích phần verify chung (`runCitation` + faithfulness) thành service dùng chung ở 17.5, không copy.                 |

**Câu hỏi mở — đã chốt (2026-09-02):**

1. **Backend LLM**: custom provider bên thứ 3 (OpenAI-compatible), không phải
   Ollama. → 17.1 verify `tool_calls` của API bên thứ 3; giữ fallback JSON.
2. **`rag_search`**: giữ **chunk thô**, agent tự tổng hợp ở `finalize`.
3. **Write-tool / HITL**: để hẳn **17.11**.
