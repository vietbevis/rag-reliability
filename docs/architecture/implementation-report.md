# Implementation Report — Agent Reliability Platform

> Refactor `rag-reliability` từ "RAG agent PHASE 17" thành **Agent Reliability
> Platform** (PHASE 18). Đọc kèm `current-state.md` (audit) và `target-state.md`
> (đích). Nguyên tắc: refactor tăng dần, giữ abstraction tốt sẵn có.
>
> **Trạng thái:** kiến trúc + runtime + provider + evaluation + benchmark +
> observability + replay ĐÃ XONG và có test. Benchmark chạy end-to-end cần một
> LLM tool-calling THẬT (deepseek-v4-flash / model tương đương) — infra + 24
> case seed + CI gate đã sẵn sàng; baseline chốt khi chạy với model thật.

---

## 1. Current architecture (trước PHASE 18)

Xem `current-state.md`. Tóm tắt: NestJS monolith, LangGraph agent loop, tool =
mảng DI phẳng (`AGENT_TOOLS` = 3 class), `LLMProvider` abstraction tốt, RAG đã
là tool, agent eval chỉ trong promptfoo `.mjs` (không typed/persist), không có
MCP / provider layer / replay / failure taxonomy cấp agent / Tracer interface.

## 2. Target architecture

```
User Query → Agent Runtime (LangGraph) → Tool Runtime (tool.node)
           → ToolRegistry → ToolProvider { Local | MCP | Future }
Trace (AgentRun.trace) → Evaluation · Benchmark · Observability · Replay
```

**Bất biến:** Agent Core (`src/agent/`) không import tool impl, không import MCP
SDK, không import Langfuse, không import benchmark. Thêm 1 tool / 1 MCP server ⇒
**0 dòng** sửa trong `src/agent/`.

## 3. Changes made

| Vùng | Thay đổi |
| --- | --- |
| `src/tools/core/` | `ToolDefinition` (+ metadata providerId/source/riskLevel/sideEffect/requiresConfirmation/enabled), `ToolResult` (`success` + `ToolError.code/retryable`, giữ `evidence`), `ToolExecutionContext` (runId/stepId/providerId/userId/tenantId), `FailureClass` + `classifyRunFailure` |
| `src/tools/providers/` | `ToolProvider` interface; `LocalToolProvider`; `MCPToolProvider` + `SdkMcpClient` (chỗ DUY NHẤT import `@modelcontextprotocol/sdk`) + JSON-Schema→Zod adapter + error adapter (`MCP_*`); `FakeMcpClient` / `createMockMcpProvider` |
| `src/tools/registry/` | `ToolRegistryService` đa provider: init lifecycle, discovery + `refreshProvider`, collision (không throw), spec-name sanitize (`rag.search`↔`rag__search`), `resolve`/`setEnabled`/`providersHealth` |
| `src/tools/impl/` | 3 tool cũ chuyển sang interface mới, id namespace (`rag.search`, `calculator.calculate`, `current_time.now`) |
| `src/agent/` | `tool.node`: risk gate + `withRetry` theo `error.retryable` + failure-threshold. `agent.node`: fallback `chatStructured` khi provider `!supportsNativeToolCalling`. `agent-state`: `consecutiveToolFailures` + `toolErrorCodes`. `agent.service`: `classifyRunFailure` → `AgentRun.failureClass`, dùng `AGENT_TRACER` (không import Langfuse) |
| `src/observability/` | `Tracer`/`RunSpan`/`NoopTracer` interface + `LangfuseTracer` adapter + `ObservabilityModule` (`@Global`) |
| `src/evaluation/agent/` | `TrajectoryView`, `AgentExpectation`, 10 evaluator (tái dùng generation-metrics + agent-metrics + answer-judge) |
| `src/benchmark/` | case schema (15 category), mock env (canned rag + mock MCP), runner, `regression.ts`, dataset-loader, CLI |
| `src/replay/` | `ReplayToolProvider` (dry-run/recorded/live-read) + `ReplayService` |
| `src/cli/agent-cli.ts` | `run` / `tools` / `providers` / `replay` |
| `src/ai/llm/providers/base-langchain-llm.provider.ts` | `chatStructured` 2 tầng: `withStructuredOutput` → fallback decode thủ công (`extractJsonObject` gỡ ```json fence) khi model bọc markdown (glm-5.3-flash) hoặc parsed sai schema |
| `src/rag/grounding/grounding-resolution.ts` | LÕI verify dùng chung `AnswerVerificationService` ↔ `RagPipelineService`: `applyNumericProvenance` (§9.3) + `resolveGroundedStatus`. numeric-provenance nay áp cho `/rag/query` |
| Prisma | migration `phase18`: `AgentRun.failureClass`/`failureDetail`, `AgentStep.providerId` |
| config | nhóm `mcp` (`MCP_ENABLED`, `MCP_SERVERS` JSON, timeout, retries), `AGENT_TOOL_FAILURE_THRESHOLD` |

## 4. Agent flow

```
Create Run → Build Context → registry.resolve(allowlist)
  → agent.node: chatWithTools (native)  |  chatStructured (fallback)
     → structured decision: tool_call[] | final
  → tool.node (per call):
       loop-detector → risk gate (enabled? args Zod? requiresConfirmation?)
       → withRetry(withTimeout(execute))  [retry ⇔ error.retryable & attempt<maxRetries]
       → normalize ToolResult → <tool_result trusted="false"> + cắt
       → đếm consecutiveToolFailures (chỉ lỗi retryable)
  → guards: budget (steps/calls/wall/tokens/cost) · no-progress · tool-failure-threshold
  → finalize.node: evidence → verify (claim→citation→faithfulness) → RagStatus
  → persist: AgentStep(+providerId) + AgentRun(+failureClass) + trace (sanitized)
  → tracer.startRun().toolCall()/step()/end()   [best-effort, no-op nếu tắt]
```

## 5. Tool architecture

`AgentTool = { definition: ToolDefinition, execute(input, ctx) → ToolResult }`.
`ToolDefinition.inputSchema/outputSchema` là **Zod** (giữ, tốt hơn `unknown` —
validate 1 lần cho cả bind LLM và đối chiếu args). `ToolResult.evidence`
first-class (cột sống reliability lab — `finalize` gom để verify).

Identity: `providerId` + canonical `toolId` (`<provider>.<name>`). LLM function
name = `toolId.replace('.','__')` (OpenAI/Anthropic không cho dấu chấm), map
2 chiều tất định trong registry.

## 6. Provider architecture

`ToolProvider { id, name, type, init, listTools, getTool, healthCheck, refresh?, close? }`.
`ToolRegistryService` gom tool từ **mọi** provider qua token `TOOL_PROVIDERS`:
- provider `init` lỗi ⇒ log ERROR + bỏ qua tool của nó (agent vẫn chạy),
- collision `toolId` ⇒ giữ provider ưu tiên cao hơn + log WARN (không throw),
- `refreshProvider(id)` thay slice tool của 1 provider,
- `onModuleDestroy` → `close()` tất cả.

Thêm `HTTPToolProvider` / `GrpcToolProvider` / `PluginToolProvider` = implement
`ToolProvider` + thêm vào factory `TOOL_PROVIDERS` trong `ToolsModule`. **0 dòng
Agent Core.**

## 7. MCP architecture

```
MCP server ─ MCP ─▶ SdkMcpClient (import @modelcontextprotocol/sdk — CHỖ DUY NHẤT)
  ─▶ MCPToolProvider
       init: connect → listTools → mcpToolToDefinition (JSON Schema → Zod, namespace id, risk)
       execute: client.callTool → normalize (isError → MCP_REMOTE_ERROR;
                exception → mcpErrorToToolError: MCP_TIMEOUT / MCP_CONNECTION_ERROR /
                MCP_PROTOCOL_ERROR / TOOL_NOT_FOUND / TOOL_ARGUMENT_ERROR)
       healthCheck: ping → healthy | degraded | unavailable
       refresh: re-listTools
  ─▶ ToolRegistry ─▶ Agent   (không thấy type MCP SDK)
```

- **Discovery động** (PROMPT §11): `MCP_SERVERS` JSON config, không hard-code tool.
- **Trust boundary** (PROMPT §14): tool output = untrusted (`<tool_result trusted="false">`);
  `riskLevel` từ `defaultRiskLevel` config, KHÔNG tin server tự khai; `destructiveHint`
  → high risk → `requiresConfirmation` → tool.node từ chối (HITL là backlog).
- **Provider chết ≠ agent chết**: `init` lỗi ⇒ provider unavailable, tool còn lại chạy.

## 8. RAG architecture

RAG là **local tool** `rag.search` (`src/tools/impl/rag-search.tool.ts`) — bọc
`RetrievalService`, trả **chunk thô** + `evidence`, lỗi hạ tầng ⇒
`RAG_RETRIEVAL_ERROR` (retryable, KHÔNG che thành "không có kết quả"). Final
answer generation thuộc `finalize.node` (agent layer) qua
`AnswerVerificationService` (dùng chung với `/rag/query`).

## 9. Evaluation architecture

Chạy trên `TrajectoryView` (chuẩn hoá từ `AgentRunOutcome`) — KHÔNG đụng runtime
nội bộ. 10 evaluator, mỗi cái trả `{ score[0..1], pass: bool|null, detail }`:

| Evaluator | Tái dùng | Kiểm |
| --- | --- | --- |
| answerCorrectness | `AnswerJudgeService` (LLM judge) | vs `expectedAnswer` |
| toolSelection | `agent-metrics.toolSelection` | P/R/F1 vs `acceptableTools` |
| toolArgument | (mới) | args vs `argumentConstraints` (path/matches/oneOf/required) |
| toolUsage | (mới) | dùng tool khi cần / không dùng khi không cần |
| groundedness | `generation-metrics.faithfulnessScore` + `claimSupportRate` | |
| citation | `generation-metrics.citationValidRate` + `citationAccuracy` | |
| hallucination | `generation-metrics.claimLevelHallucinationRate` + abstain-khi-`mustAbstain` | |
| efficiency | `agent-metrics.stepEfficiency` + maxSteps/maxToolCalls | |
| recovery | (mới) | lỗi tool rồi vẫn về đích grounded/abstain |
| safety | (mới) | tool cấm / high-risk / `answerMustNotContain` (injection) |

Trajectory evaluation (PROMPT §25): tập chấp nhận/cấm + ràng buộc, **không**
`expected_exact_tool_sequence`.

## 10. Benchmark architecture

```
benchmarks/agent/datasets/*.jsonl → loadBenchmarkCases (Zod validate)
  → AgentBenchmarkRunner.run:
      mỗi case: buildCaseRegistry (mock local + mock MCP) → AgentGraphBuilder mới
        → run → toTrajectoryView → evaluateTrajectory(evaluators theo category)
  → aggregate: taskSuccess, per-evaluator mean, byCategory, byFailureClass, avg*
  → results/latest.json ; compareToBaseline(baseline.json, thresholds.json) → diff.json
  → exit≠0 khi regressed (CI gate)
```

- **Mock hoàn toàn** (PROMPT §29): `CannedRagSearchTool` (chunk theo keyword),
  `FakeMcpClient` qua `MCPToolProvider` thật (chỉ transport fake) — deterministic,
  nhanh, lặp lại. RAG/MCP server THẬT = suite tích hợp riêng (không trộn).
- **24 case seed** (`benchmarks/agent/datasets/`), 14 category — cover
  basic/rag/tool-selection/tool-args/multi-step/failure-recovery/adversarial/
  mcp-selection/mcp-execution/mcp-args/mcp-failure/mcp-provider-failure/
  cross-provider/mcp-workflow.
- **Regression** (PROMPT §31): threshold tuyệt đối + sụt so baseline, config qua
  `benchmarks/agent/thresholds.json`.

## 11. Observability

`Tracer` interface (`src/observability/tracer.ts`) — `startRun().toolCall()/step()/end()`.
`LangfuseTracer` là adapter (best-effort). `AgentService` inject `AGENT_TRACER`,
KHÔNG import Langfuse. Trace ghi `providerId` + `toolId` + `errorCode` cho mỗi
tool call ⇒ tách được Agent error / Tool error / MCP error. `trace-sanitizer`
khử secret/PII trước khi lưu `AgentRun.trace` và trước khi gửi tracer.

## 12. Replay

`ReplayService.replay(runId, mode)`:
- `dry-run` — không execute tool nào, trả recorded (hoặc lỗi nếu không có).
- `recorded` — trả kết quả đã ghi cho (toolName+args) khớp.
- `live-read` — execute THẬT nếu `sideEffect === 'read-only'`, còn lại recorded.

Tool `side-effecting` **không bao giờ** blind replay (PROMPT §36). Trả
`ReplayDiff` (answer / finalStatus / toolPath / stepCount đổi không) +
`sideEffectsSkipped`.

## 13. Tests

- 88 suite / 643 test (từ 79/584). Thêm: `tools/core/failure`, `tools/registry`
  (collision/spec-name/refresh/disable), `tools/providers/mcp/*` (schema adapter,
  error adapter, provider qua FakeMcpClient — discovery/execute/isError/inject-
  failure/unavailable/health/refresh), `tools/impl/*`, `evaluation/agent/evaluators`,
  `benchmark/regression`, `benchmark/dataset-loader` (24 case validate),
  `benchmark/agent-benchmark.runner` (scripted fake — calc/mcp/adversarial),
  `replay/replay-tool.provider`.
- typecheck + lint sạch trên toàn bộ code mới.
- e2e (cần DB/Redis): specs agent hiện có đã cập nhật tên tool
  (`calculator__calculate`).

## 14. Benchmark results

Infra + 24 case + CI gate sẵn sàng. **Chưa chốt baseline** — cần chạy
`npm run benchmark:agent -- --baseline` với `LLM_PROVIDER=custom` +
`CUSTOM_LLM_*` (model tool-calling thật). Với `LLM_PROVIDER=fake`, agent không
gọi tool (fake không script) nên benchmark chỉ có nghĩa với model thật. Bộ test
`agent-benchmark.runner.spec.ts` xác nhận runner + evaluator + mock provider
hoạt động (fake có script).

## 15. Known limitations

- **Fallback `chatStructured`**: ĐÃ verify deterministic
  (`fake-llm.setNativeToolCalling(false)` + `scriptStructured` → 2 test trong
  `agent-graph.builder.spec`). Backend b.ai hỗ trợ native ⇒ đường chính vẫn là
  `chatWithTools`. `chatStructured` cũng đã 2 tầng (gỡ ```json fence) cho glm.
- **HITL / write-tool**: risk gate **từ chối** high-risk tool
  (`PERMISSION_DENIED`) — chấp nhận cho v1 read-only. Luồng `/approve` +
  `PENDING_APPROVAL` là backlog khi có write-tool (PROMPT §14).
- **`RagPipelineService`**: đã hợp nhất **phần thực sự chung** với
  `AnswerVerificationService` qua `grounding-resolution.ts` (numeric-provenance +
  map status). KHÔNG merge toàn bộ: `/rag/query` khớp evidence theo
  citation-marker của generator + tối ưu `gen.claims` — merge hết sẽ degrade RAG
  (thêm LLM call, mất tín hiệu citation-marker).
- **Replay** với run có LLM khác model gốc: answer diff có thể do model (đúng
  bản chất regression-theo-trace).
- **MCP schema adapter**: subset JSON Schema (string/number/int/bool/array/
  object/enum/anyOf). allOf/$ref → `z.unknown()`.
- **Layout**: `src/evaluation/agent/` mới; phần RAG (`src/evaluation/*`) giữ
  nguyên vị trí để không đụng test.

## 16. How to add a new Local Tool

1. Tạo class trong `src/tools/impl/` implement `AgentTool`:
   ```ts
   export class WeatherTool implements AgentTool {
     readonly definition = localToolDefinition({
       id: 'weather.current', displayName: 'Weather',
       description: 'Thời tiết hiện tại theo thành phố…',
       inputSchema: z.object({ city: z.string() }),
       outputSchema: z.object({ tempC: z.number(), summary: z.string() }),
       timeoutMs: 5000,
     });
     async execute(input, ctx): Promise<ToolResult> { … return { success:true, data, evidence:[…] } }
   }
   ```
2. Thêm vào `ToolsModule`: providers `[…, WeatherTool]` và
   `inject: [Calculator, CurrentTime, RagSearch, WeatherTool]` của
   `LOCAL_AGENT_TOOLS`.
3. Viết `.spec.ts` cạnh file. **Không** sửa gì trong `src/agent/`.
4. `npm run typecheck && npm test`. Agent tự thấy tool (registry gom lúc boot).

## 17. How to add a new MCP Server (KHÔNG sửa Agent Core)

1. **Config** `.env`:
   ```
   MCP_ENABLED=true
   MCP_SERVERS=[{"id":"actvn-mcp","transport":"streamable-http",
     "url":"https://actvn-mcp.example.com/mcp",
     "headers":{"Authorization":"Bearer ${ACTVN_MCP_TOKEN}"},
     "defaultRiskLevel":"medium"}]
   ```
   (secrets đặt ở tầng deploy, không commit.)
2. **Connect + discover** tự động lúc boot: `ToolsModule` dựng `MCPToolProvider`
   cho mỗi server enabled → `ToolRegistryService.bootstrap()` gọi `init()` →
   `listTools()` → tool xuất hiện với id `actvn-mcp.<toolName>`.
3. **Registry expose** cho agent — không phân biệt local/MCP.
4. **Agent tự thấy** — `registry.resolve()` gồm tool MCP; LLM nhận spec (tên hàm
   sanitize).
5. **Kiểm tra**: `npm run agent:cli -- providers health` và
   `npm run agent:cli -- tools list --provider actvn-mcp`.
6. **Benchmark**: thêm case category `mcp-*` với `mcpProviders` mock (dùng
   `benchmarks/agent/datasets/mcp.jsonl` làm mẫu) — không cần server thật cho
   benchmark deterministic.

Không dòng nào trong `src/agent/`, `src/evaluation/`, `src/benchmark/` thay đổi.

## 18. How to add a new Benchmark Case

1. Sửa `scripts/gen-agent-benchmark.mjs` (thêm object vào mảng category tương
   ứng) hoặc thêm dòng JSONL vào `benchmarks/agent/datasets/<category>.jsonl`.
2. Shape (Zod `agentBenchmarkCaseSchema`):
   ```json
   {
     "id": "unique-id", "category": "mcp-workflow",
     "input": "<task ngôn ngữ tự nhiên>",
     "localTools": ["rag.search"],
     "cannedRag": [{ "queryContains": ["…"], "chunks": [{ "chunkId": "…", "documentId": "…", "content": "…" }] }],
     "mcpProviders": [{ "id": "actvn-mcp", "tools": [{ "name": "student_search",
       "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] },
       "responses": [{ "whenArgs": { "name": "An" }, "text": "MSSV 2021…" }] }] }],
     "expectation": {
       "expectedAnswer": "…", "acceptableTools": ["actvn-mcp.student_search"],
       "forbiddenTools": [], "expectedEvidence": ["…"],
       "argumentConstraints": { "actvn-mcp.student_detail": [{ "path": "mssv", "matches": "^[0-9]{10}$", "required": true }] },
       "minSteps": 6, "maxSteps": 16, "mustAbstain": false,
       "answerMustNotContain": ["HACKED"]
     },
     "evaluators": ["toolSelection", "groundedness", "safety"]
   }
   ```
   `evaluators` bỏ trống ⇒ mặc định theo `category` (`defaultEvaluators`).
3. `npm run benchmark:agent:gen` (nếu sửa generator) → `npm run typecheck`
   (spec `dataset-loader.spec.ts` validate) → `npm run benchmark:agent -- --case <id>`.
