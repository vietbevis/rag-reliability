# Target State — Agent Reliability Platform

> Kiến trúc đích cho `rag-reliability`: một **Agent Runtime** có khả năng mở
> rộng, đo lường và benchmark reliability — trong đó **RAG là một Tool**, **Local
> tool là Tool**, **MCP tool là Tool qua MCP Provider**, và **Agent Core không
> bao giờ biết Tool đến từ đâu**.
>
> Đọc kèm `current-state.md` (audit). Nguyên tắc: **refactor tăng dần**, không
> rewrite; giữ abstraction hiện tại nếu nó đã tốt hơn PROMPT đề xuất (nêu rõ lý
> do bên dưới).

---

## 1. Bức tranh tổng

```
                    ┌──────────────────────┐
                    │      User Query      │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │     Agent Runtime    │   src/agent/
                    │  Planning / Decision │   (LangGraph StateGraph — giữ nguyên)
                    │  Loop / State        │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │     Tool Runtime     │   tool.node — execute + retry + normalize + timeout
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │     Tool Registry    │   src/tools/registry/
                    │  resolve · collision │
                    │  refresh · lifecycle │
                    └──────────┬───────────┘
                ┌──────────────┼───────────────────────┐
                ▼              ▼                        ▼
       LocalToolProvider  MCPToolProvider        FutureProvider
       src/tools/         src/tools/             (HTTP / gRPC / Plugin / …)
       providers/local/   providers/mcp/
                │              ├── actvn-mcp
        ┌───────┼───────┐      ├── another-mcp
        ▼       ▼       ▼      └── …
     rag.search calculator current_time

Bên ngoài Runtime — tiêu thụ **Trace**, không đụng Agent Core:

                    ┌──────────────────────┐
                    │     Agent Runtime    │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │        Trace         │  AgentRun.trace (Postgres) = nguồn sự thật
                    └──────────┬───────────┘
          ┌──────────┬─────────┼──────────┬──────────────┐
          ▼          ▼         ▼          ▼              ▼
     Evaluation  Benchmark  Observability  Replay   Reliability Report
```

**Bất biến (PROMPT §1):** Agent Core KHÔNG `if tool == 'rag_search'`; KHÔNG import
MCP SDK; KHÔNG import Langfuse; KHÔNG import benchmark. Thêm 1 tool hoặc 1 MCP
server ⇒ **0 dòng sửa trong `src/agent/`**.

---

## 2. Layer & phụ thuộc (chiều mũi tên = "được phép import")

```
src/agent/            (Agent Core)
   │  ─────▶  src/tools/core/     (ToolDefinition, ToolResult, ToolExecutionContext, AgentTool, ToolError)
   │  ─────▶  src/tools/registry/ (ToolRegistry — trả AgentTool đã chuẩn hoá)
   │  ─────▶  src/ai/llm/         (LLMProvider — provider-agnostic, GIỮ NGUYÊN)
   │  ─────▶  src/observability/  (Tracer interface — KHÔNG phải Langfuse)
   │  ─────▶  src/rag/grounding/answer-verification.service  (finalize verify — dùng chung với RAG)
   │
   └──✗ KHÔNG import: src/tools/providers/**, @modelcontextprotocol/sdk, langfuse, src/benchmark/**, src/evaluation/**

src/tools/providers/mcp/   ─────▶  @modelcontextprotocol/sdk   (CHỖ DUY NHẤT biết MCP)
src/tools/providers/local/ ─────▶  src/rag/**, src/ai/**       (bọc service nội bộ thành tool)

src/evaluation/  ─────▶  Trace + src/tools/core (types)     — KHÔNG import src/agent runtime nội bộ
src/benchmark/   ─────▶  src/evaluation + AgentService (chạy run)  — tách hẳn khỏi Agent Core
src/observability/langfuse/ ─────▶  langfuse  (adapter — implements Tracer)
src/replay/      ─────▶  Trace + ToolRegistry (mock/dry-run)
```

---

## 3. Core Tool Abstraction (`src/tools/core/`)

### 3.1. Tool identity (PROMPT §7)

```ts
// Định danh canonical, ổn định, có namespace theo provider.
type ToolId = string;        // "rag.search", "calculator.calculate", "actvn-mcp.student_search"
type ProviderId = string;    // "local", "actvn-mcp", "another-mcp"

// Quy ước: toolId = `${providerId}.${localName}` với provider MCP;
//          local provider giữ tên ngắn có chấm ("rag.search") để tương thích lịch sử.
```

### 3.2. ToolDefinition

```ts
export interface ToolMetadata {
  providerId: ProviderId;
  source: 'local' | 'mcp' | 'http' | 'grpc' | 'plugin';
  version?: string;
  riskLevel: 'low' | 'medium' | 'high';       // read-only → low; mutation/send/delete → high
  sideEffect: 'read-only' | 'side-effecting';  // cho Replay (PROMPT §36)
  requiresConfirmation: boolean;               // high-risk ⇒ true (PROMPT §14)
  enabled: boolean;
  tags?: string[];
  timeoutMs: number;
  maxRetries: number;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: ToolId;
  displayName: string;
  description: string;                          // prompt-facing — KHI NÀO dùng
  inputSchema: ZodType<TInput>;                 // GIỮ Zod (tốt hơn `unknown` của PROMPT §6 — validate 1 lần, 2 phía)
  outputSchema: ZodType<TOutput>;
  metadata: ToolMetadata;
}
```

> **Vì sao giữ Zod thay vì `inputSchema: unknown` (PROMPT §6):** codebase đã bind
> Zod vào LLM (`ToolSpec.parameters`) và validate lại `ToolCall.args` ở
> `validateToolCalls` + `tool.node`. MCP trả JSON Schema ⇒ `MCPToolSchemaAdapter`
> convert JSON Schema → Zod một lần lúc discovery. Không hạ cấp abstraction.

### 3.3. ToolResult (PROMPT §6, §13) — giữ `evidence`

```ts
export type ToolErrorCode =
  | 'TOOL_ARGUMENT_ERROR' | 'TOOL_EXECUTION_ERROR' | 'TOOL_TIMEOUT' | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED' | 'PERMISSION_DENIED' | 'LOOP_BLOCKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MCP_CONNECTION_ERROR' | 'MCP_TIMEOUT' | 'MCP_PROTOCOL_ERROR' | 'MCP_REMOTE_ERROR'
  | 'RAG_RETRIEVAL_ERROR'
  | 'UNKNOWN_ERROR';

export interface ToolError {
  code: ToolErrorCode;
  message: string;                 // feed lại model — ngắn, không lộ secret
  retryable: boolean;
  providerId?: ProviderId;
}

export interface ToolResult<T = unknown> {
  success: boolean;                // đổi `ok` → `success` (đồng bộ PROMPT); alias giữ 1 minor
  data?: T;                        // optional (bỏ `data: null` khi lỗi)
  error?: ToolError;
  evidence: ToolEvidence[];        // GIỮ — cột sống của RAG reliability lab
  usage?: TokenUsage;
  metadata?: { latencyMs?: number; source?: string; truncated?: boolean; citations?: unknown[] };
}
```

> **Vì sao giữ `evidence` first-class (không có trong PROMPT §6):** `finalize.node`
> gom evidence toàn run để verify grounding/citation/faithfulness. Đây là điểm
> khác biệt của "reliability lab" so với agent framework thường. MCP tool trả
> evidence rỗng cũng hợp lệ (data → evidence do finalize suy ra khi cần).

### 3.4. ToolExecutionContext (PROMPT §18)

```ts
export interface ToolExecutionContext {
  runId: string;
  stepId: string;
  providerId: ProviderId;
  userId?: string;
  tenantId?: string;
  signal: AbortSignal;
  logger: Logger;
  metadata?: Record<string, unknown>;
}
```

### 3.5. AgentTool (runtime handle từ provider)

```ts
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  definition: ToolDefinition<TInput, TOutput>;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}
```

---

## 4. Tool Provider (`src/tools/providers/`)

**MCP KHÔNG phải tool-type đặc biệt — MCP là một Provider.** (PROMPT §8)

```ts
export interface ProviderHealth {
  providerId: ProviderId;
  status: 'healthy' | 'degraded' | 'unavailable';
  detail?: string;
  toolCount: number;
  checkedAt: string;
}

export interface ToolProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type: 'local' | 'mcp' | 'http' | 'grpc' | 'plugin';

  init(): Promise<void>;                       // connect / handshake (no-op cho local)
  listTools(): Promise<ToolDefinition[]>;      // discovery
  getTool(id: ToolId): Promise<AgentTool | undefined>;
  healthCheck(): Promise<ProviderHealth>;
  refresh?(): Promise<void>;                   // re-discover (MCP server đổi tool)
  close?(): Promise<void>;                     // lifecycle
}
```

### 4.1. LocalToolProvider (`providers/local/`)
- Nhận `AgentTool[]` qua DI token `LOCAL_AGENT_TOOLS` (mảng class hiện có, bọc
  thành `AgentTool` mới).
- `init` = no-op; `healthCheck` = luôn `healthy`; `listTools` = định nghĩa tĩnh.
- 3 tool: `rag.search`, `calculator.calculate`, `current_time.now` — `source:'local'`,
  `riskLevel:'low'`, `sideEffect:'read-only'`.

### 4.2. MCPToolProvider (`providers/mcp/`) — PROMPT §10-13

```
MCPToolProvider
 ├── MCPClient            (bọc @modelcontextprotocol/sdk — Client + transport stdio|SSE|streamable-HTTP)
 ├── MCPToolSchemaAdapter (JSON Schema → Zod; MCP tool def → ToolDefinition, namespace id)
 ├── MCPErrorAdapter      (lỗi SDK / JSON-RPC → ToolError { code: MCP_* , retryable })
 └── lifecycle: init(connect+initialize+listTools) · refresh(re-listTools) · healthCheck(ping) · close
```

- **Discovery động (PROMPT §11):** `init` → `client.listTools()` → adapter →
  `ToolDefinition[]`. `refresh()` re-list, registry invalidate + re-register.
- **Schema adapter (PROMPT §12):** MCP JSON Schema → Zod (dùng `json-schema-to-zod`
  hoặc tự map subset). Module `agent/`, `evaluation/`, `benchmark/` **KHÔNG BAO
  GIỜ** thấy type của MCP SDK.
- **Error normalize (PROMPT §13):** connection refused → `MCP_CONNECTION_ERROR`
  (retryable); timeout → `MCP_TIMEOUT` (retryable); JSON-RPC error −32xxx →
  `MCP_PROTOCOL_ERROR` (non-retryable); tool trả `isError` → `MCP_REMOTE_ERROR`;
  không thấy tool → `TOOL_NOT_FOUND`. KHÔNG gộp hết thành "tool failed".
- **Trust boundary (PROMPT §14):** MCP tool output = untrusted; `tool.node` đã bọc
  `<tool_result trusted="false">` + system prompt — giữ. MCP tool metadata mặc
  định `riskLevel` từ config (không tin server tự khai `low`).
- **Failure không làm hỏng agent:** `init` lỗi ⇒ provider `unavailable`, registry
  bỏ qua tool của nó, agent vẫn chạy với tool còn lại. MCP failure ≠ success.

### 4.3. FutureToolProvider (PROMPT §16)
Thêm `HTTPToolProvider` / `GrpcToolProvider` / `PluginToolProvider` = implement
`ToolProvider` + đăng ký trong config `providers:`. **0 dòng sửa Agent Core.**

---

## 5. Tool Registry (`src/tools/registry/`) — PROMPT §15

```ts
@Injectable()
export class ToolRegistry {
  // nạp providers từ config; init() tất cả; gom listTools(); phát hiện collision.
  async bootstrap(): Promise<void>;
  async refreshProvider(providerId: ProviderId): Promise<void>;

  list(): ToolDefinition[];                          // mọi tool enabled, đã chuẩn hoá
  resolve(allowlist?: string[]): AgentTool[];        // cho 1 request (giữ semantics hiện tại)
  get(id: ToolId): AgentTool | undefined;
  toSpecs(tools: AgentTool[]): ToolSpec[];           // giữ — feed LLM

  setEnabled(id: ToolId, enabled: boolean): void;    // enable/disable runtime
  providers(): ProviderHealth[];                     // cho CLI `providers health`
}
```

- **Collision (PROMPT §7):** 2 provider cùng `toolId` ⇒ log WARN + giữ provider
  ưu tiên cao hơn (thứ tự trong config) + expose cả 2 qua `providers()` để debug.
  KHÔNG throw (một MCP server chết không được làm sập boot).
- **Refresh/invalidate:** `refreshProvider` gọi `provider.refresh()` → thay slice
  tool của provider đó trong map; giữ nguyên tool provider khác.
- **Lifecycle:** `onModuleDestroy` → `provider.close()` tất cả.

---

## 6. Agent Runtime (`src/agent/`) — giữ LangGraph, vá 4 điểm

```
User Query → Create Run → Build Context → Registry.resolve(allowlist)
  → LLM Decision (chatWithTools | fallback chatStructured)
  → Validate Decision → Validate Args (Zod) → Risk/permission policy
  → Tool Runtime: execute (withTimeout + withRetry theo retryable) 
  → Normalize ToolResult → Append Observation → LLM Decision → … → Finalize
```

| Vá | Chi tiết | File |
| --- | --- | --- |
| **Retry policy (PROMPT §22)** | `tool.node` bọc `withRetry(withTimeout(execute))`; chỉ retry khi `error.retryable && attempt < definition.metadata.maxRetries`; backoff. | `graph/nodes/tool.node.ts` |
| **Failure threshold (PROMPT §23)** | State thêm `consecutiveToolFailures`; ≥ N ⇒ stopReason `tool_failure_threshold` → finalize. | `agent-state.ts`, `budget.guard.ts` |
| **Fallback structured (PROMPT §20, P12)** | `agent.node`: `llm.supportsNativeToolCalling()===false` ⇒ `chatStructured` với schema `AgentDecision` union `{type:'tool_call',toolId,arguments}\|{type:'final',answer}`; map về cùng `LLMToolResponse`. | `agent.node.ts` |
| **Risk gate (PROMPT §14, §21)** | Trước execute: tool `enabled`? args hợp lệ Zod? `riskLevel==='high' && requiresConfirmation` ⇒ v1 **từ chối** + note (HITL là backlog). | `tool.node.ts` |

**Structured decision (PROMPT §20):** giữ native `tool_calls`; union `AgentDecision`
chỉ dùng cho đường fallback. KHÔNG mở `ask_user`/`delegate`/`retry` (chưa cần).

**KHÔNG lệ thuộc chain-of-thought (PROMPT §5):** trace chỉ ghi observable —
decision / selectedTool / arguments / toolResult / observation / step / latency /
tokens / errors / finalAnswer. Không lưu hidden reasoning.

---

## 7. Failure Taxonomy (`src/tools/core/failure.ts`) — PROMPT §32

```ts
export type FailureClass =
  | 'AGENT_DECISION_ERROR' | 'TOOL_SELECTION_ERROR' | 'TOOL_ARGUMENT_ERROR'
  | 'TOOL_EXECUTION_ERROR' | 'PROVIDER_UNAVAILABLE'
  | 'MCP_PROVIDER_ERROR' | 'MCP_CONNECTION_ERROR' | 'MCP_TIMEOUT'
  | 'RAG_RETRIEVAL_ERROR' | 'RAG_GROUNDEDNESS_ERROR'
  | 'LLM_ERROR' | 'CONTEXT_ERROR' | 'AUTHORIZATION_ERROR' | 'SAFETY_POLICY_ERROR'
  | 'LOOP_ERROR' | 'TIMEOUT_ERROR' | 'UNKNOWN_ERROR';
```

- `AgentRun` thêm cột `failureClass String?` + `failureDetail String?`.
- `classifyRunFailure(outcome)` — hàm thuần: map `stopReason` + step errors +
  `ToolError.code` + finalize status → `FailureClass`. Report trả lời **"agent
  fail vì đâu"**, không chỉ `score = 0`.
- Tái dùng `HallucinationRootCause` (RAG) làm sub-class cho `RAG_*`.

---

## 8. Evaluation Framework (`src/evaluation/agent/`) — PROMPT §24-25

**Tách khỏi Runtime — chạy trên Trace, không trên Agent code.**

```
AgentRun (+ trace + steps)  →  TrajectoryView (chuẩn hoá đọc từ trace)
   → Evaluator[]  →  EvaluatorResult[]  →  aggregate → Metrics
```

| Evaluator | Nguồn tái dùng | Ghi chú |
| --- | --- | --- |
| `AnswerCorrectnessEvaluator` | `answer-judge.service.ts` (LLM-judge có sẵn) | vs `expectedAnswer` |
| `ToolSelectionEvaluator` | `agent-metrics.toolSelection` (P/R/F1) | acceptable/forbidden set, KHÔNG ép 1 trajectory đúng (PROMPT §25) |
| `ToolArgumentEvaluator` | mới — so args vs `argumentConstraints` (JSONPath/regex/enum) | |
| `ToolUsageEvaluator` | mới — dùng tool khi cần / không dùng khi không cần | |
| `GroundednessEvaluator` | `generation-metrics.faithfulnessScore` + `claimSupportRate` | reuse RAG |
| `CitationEvaluator` | `generation-metrics.citationAccuracy` + `citationValidRate` | reuse RAG |
| `HallucinationEvaluator` | `generation-metrics.claimLevelHallucinationRate` + `hallucinationRateProxy` | reuse RAG |
| `EfficiencyEvaluator` | `agent-metrics.stepEfficiency` + steps/toolCalls/latency/tokens | |
| `RecoveryEvaluator` | mới — sau khi tool fail, agent có xoay hướng & vẫn về đích không | dùng `ToolError` trong trace |
| `SafetyEvaluator` | mới — có gọi tool `forbidden` / `high-risk` / tuân injection không | `not-contains` + rubric |

- **TrajectoryEvaluation (PROMPT §25):** case định nghĩa `acceptableTools` /
  `forbiddenTools` / `requiredEvidence` / `argumentConstraints` / `maxSteps` /
  `maxToolCalls` — KHÔNG `expected_exact_tool_sequence`.
- Persist: `EvaluationRun` (mở rộng — thêm `kind: 'rag' | 'agent'`) +
  `EvaluationResult` (per case, per evaluator scores + `failureClass`).

---

## 9. Benchmark Framework (`src/benchmark/`) — PROMPT §26-31

```
Benchmark → Dataset → Scenario → AgentService.run → Trace → Evaluator[] → Metrics → Report
                                      │
                                      └─ Mock MCP Provider (deterministic)  hoặc  Real MCP (suite riêng)
```

### 9.1. Case schema (`benchmarks/agent/schema.ts`)

```ts
interface AgentBenchmarkCase {
  id: string;
  category: 'basic' | 'rag' | 'tool-selection' | 'tool-args' | 'multi-step'
          | 'failure-recovery' | 'adversarial'
          | 'mcp-discovery' | 'mcp-selection' | 'mcp-args' | 'mcp-execution'
          | 'mcp-failure' | 'mcp-provider-failure' | 'cross-provider' | 'mcp-workflow';
  input: string;
  corpus?: CorpusDoc[];                  // reuse case.schema corpusDocSchema
  providers?: Array<{ id: string; type: 'local' | 'mock-mcp'; tools?: MockMcpTool[] }>;
  expectedAnswer?: string;
  acceptableTools?: string[];
  forbiddenTools?: string[];
  expectedEvidence?: string[];
  argumentConstraints?: Record<string, { path: string; matches?: string; oneOf?: string[] }>;
  maxSteps?: number;
  maxToolCalls?: number;
  mustAbstain?: boolean;
  evaluators?: string[];                 // mặc định = theo category
  injectFailure?: { toolId: string; error: ToolErrorCode; afterCalls?: number };  // failure-recovery
}
```

### 9.2. Mock MCP (PROMPT §29)
- `MockMCPToolProvider implements ToolProvider` — nhận `MockMcpTool[]` (id, schema,
  handler tất định, hoặc `injectFailure`). Deterministic, nhanh, lặp lại được.
- **Không trộn** với suite `benchmarks/agent/live-mcp/` (real MCP server).

### 9.3. Runner + Reporter
- `AgentBenchmarkRunner.run(datasetPath)` — mỗi case: build providers (local +
  mock-mcp) → `AgentService.run(input, {toolAllowlist})` → load trace →
  evaluators → per-case score + `failureClass`.
- `benchmarks/agent/results/{baseline,latest,diff}.json` (PROMPT §31).
- Metrics tổng: taskSuccess, toolSelectionAccuracy, argumentAccuracy,
  groundedness, citationAccuracy, hallucinationRate, recoveryRate, avgSteps,
  avgToolCalls, avgLatencyMs, tokenUsage, + breakdown theo `category` &
  `failureClass`.

### 9.4. MCP benchmark bắt buộc (PROMPT §28)
discovery · selection · args · execution · failure · provider-failure ·
cross-provider (local `rag.search` vs `actvn-mcp.student_search`) · multi-tool
workflow (`student_search → student_detail → rag.search → final`).

### 9.5. Regression (PROMPT §31)
`compareToBaseline` (generalize `BenchmarkService`) — threshold **config-able**:

```
toolSelectionAccuracy  ≥ 0.90        hallucinationRate  ≤ 0.03
groundedness           ≥ 0.90        taskSuccess        ≥ 0.85
argumentAccuracy       ≥ 0.90        recoveryRate       ≥ 0.80
avgLatencyMs           ≤ 1.5× baseline
```

CI: exit ≠ 0 khi regressed — song song RAG gate (`regression.md`).

---

## 10. Observability (`src/observability/`) — PROMPT §33-35

```ts
export interface Tracer {
  startRun(input: { runId: string; task: string; metadata?: Record<string,unknown> }): RunSpan;
}
export interface RunSpan {
  toolCall(e: {
    stepId: string; providerId: ProviderId; toolId: ToolId; source: string;
    arguments: unknown; startedAt: number; endedAt: number; latencyMs: number;
    result?: unknown; error?: ToolError;
  }): void;
  step(e: { stepId: string; type: string; note?: string; tokens?: TokenUsage; latencyMs?: number }): void;
  end(e: { status: string; finalStatus?: string; answer?: string | null; failureClass?: FailureClass; usage: TokenUsage }): void;
}
```

- `NoopTracer` (mặc định) · `LangfuseTracer implements Tracer`
  (`src/observability/langfuse/` — chỗ DUY NHẤT import `langfuse`).
- `AgentService` inject `Tracer` (interface) — hết coupling.
- **Trace phân biệt provider (PROMPT §34):** mọi tool call ghi `providerId` +
  `toolId` + `source` + `error.code` ⇒ tách được Agent error / Tool error / MCP
  error / Backend error. `AgentStep` thêm cột `providerId String?`.
- **Redaction (PROMPT §35):** `trace-sanitizer.util` (mở rộng pattern) áp trước
  khi lưu `AgentRun.trace` **và** trước khi gửi Tracer — password/token/secret/
  PII/authorization header.

---

## 11. Replay (`src/replay/`) — PROMPT §36

```
AgentRun.trace (recorded)  →  ReplayRunner
   ├─ mode: 'dry-run'      → không execute tool nào; so decision path
   ├─ mode: 'recorded'     → tool trả kết quả đã ghi trong trace (mock từ AgentStep.toolOutput)
   └─ mode: 'live-read'    → chỉ execute tool `sideEffect: 'read-only'`; side-effecting → dùng recorded
   →  ReplayDiff  (decision khác? tool khác? answer khác? status khác?)
```

- **Side-effect guard (PROMPT §36):** `metadata.sideEffect === 'side-effecting'`
  ⇒ **không bao giờ** blind replay (delete/send/update/create/payment). v1 mọi
  tool read-only nên `live-read` == full; seam sẵn cho write-tool 17.11.
- Dùng cho regression theo trace: replay baseline run với code mới → diff.

---

## 12. Config (`providers:`) — PROMPT §39-40

```yaml
# config/providers.yaml  (hoặc env JSON) — secrets KHÔNG commit
providers:
  - id: local
    type: local
    enabled: true
  - id: actvn-mcp
    type: mcp
    enabled: false            # bật khi có server
    transport: streamable-http # stdio | sse | streamable-http
    url: ${ACTVN_MCP_URL}
    headers: { Authorization: "Bearer ${ACTVN_MCP_TOKEN}" }
    defaultRiskLevel: medium   # không tin server tự khai
    refreshIntervalMs: 0
```

- `env.schema.ts` thêm nhóm `providers` (validate zod). `configuration.ts` →
  `AppConfig.providers: ProviderConfig[]`.
- `actvn-mcp` là **project riêng** trong tương lai — `rag-reliability` KHÔNG embed
  implementation. Chỉ nói MCP với nó.

---

## 13. CLI (`src/cli/` hoặc mở rộng `evaluation/cli/`) — PROMPT §37-38

```
agent run "<task>" [--tools a,b] [--budget 0.1]
agent tools list [--provider <id>]
agent tools inspect <toolId>
agent providers list
agent providers health
agent providers refresh <id>
agent benchmark [--dataset <path>] [--case <id>] [--baseline] [--diff]
agent evaluate --run <agentRunId>
agent replay <agentRunId> [--mode dry-run|recorded|live-read]
```

Cắm vào `package.json` scripts song song `evaluate:*` hiện có.

---

## 14. Folder structure đích (adapt, không rename bừa)

```
src/
├── agent/                    # Agent Core — GIỮ (LangGraph)
│   ├── runtime/ (agent.service, agent-graph.builder)
│   ├── graph/{nodes,guards}
│   └── state/ (agent-state)
├── tools/
│   ├── core/                 # ToolDefinition, ToolResult, ToolError, ToolExecutionContext, AgentTool, failure.ts
│   ├── registry/             # ToolRegistry
│   ├── providers/
│   │   ├── local/            # LocalToolProvider + LOCAL_AGENT_TOOLS
│   │   └── mcp/              # MCPToolProvider, MCPClient, schema-adapter, error-adapter
│   └── impl/                 # rag-search, calculator, current-time (di chuyển từ agent/tools/)
├── ai/llm/                   # GIỮ NGUYÊN — provider-agnostic LLM
├── rag/                      # GIỮ — retrieval/context/grounding; rag/grounding/answer-verification dùng chung
├── evaluation/
│   ├── rag/                  # đường RAG hiện tại (đổi tên gọn)
│   ├── agent/                # evaluators + trajectory-view + metrics (hợp nhất agent-metrics + reuse generation-metrics)
│   └── shared/               # answer-judge, statistics, retrieval/generation-metrics
├── benchmark/                # runner, reporters, mock-mcp
├── observability/            # Tracer interface + langfuse/ adapter + trace-sanitizer
├── replay/
└── cli/

benchmarks/agent/
├── cases/  datasets/  expected/  results/{baseline,latest,diff}.json  live-mcp/

docs/
├── architecture/ (current-state, target-state, implementation-report)
├── agent/  tools/  mcp/  evaluation/  benchmark/  reliability/
```

---

## 15. Definition of Done → map file

| DoD (PROMPT §46) | Nơi hiện thực |
| --- | --- |
| Agent Core không phụ thuộc MCP SDK / tool impl | §2 lint rule + `src/tools/core` |
| ToolProvider / LocalToolProvider / MCPToolProvider | `src/tools/providers/**` |
| RAG là Tool trả evidence, final answer thuộc agent | §3 (đã gần xong) + `finalize.node` |
| MCP discovery động / schema normalize / error normalize / health / lifecycle / collision | §4.2, §5 |
| structured decision / arg validation / retry / timeout / loop / maxSteps / graceful | §6 (vá 4 điểm) |
| Evaluation: correctness/toolSelection/args/groundedness/citation/hallucination/efficiency/recovery/safety | §8 |
| Benchmark: dataset/runner/evaluator/report/baseline/regression/20-30 case | §9 |
| MCP benchmark: discovery/selection/args/execution/failure/recovery/cross-provider/workflow | §9.4 |
| Observability: run/step/tool/provider/error trace + latency + tokens + redaction | §10 |
| Replay: recorded run / mock / dry-run / side-effect protection | §11 |

---

## 16. Không over-engineer (PROMPT §44)

KHÔNG microservice / event bus / workflow engine / K8s / planner phức tạp /
multi-agent. Chỉ: Reliable Agent Runtime + Tool Runtime + MCP + Evaluation +
Benchmark + Observability + Replay. Khi có nhiều phương án → **chọn đơn giản
hơn**, nhưng giữ khả năng mở rộng qua `ToolProvider`.
