# Tool development

## Hợp đồng

```ts
interface AgentTool<TInput, TOutput> {
  readonly definition: ToolDefinition<TInput, TOutput>;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}
```

- `definition.inputSchema` / `outputSchema` là **Zod** — validate 1 lần, dùng cả
  khi bind vào LLM và khi đối chiếu args model sinh.
- `definition.metadata`: `providerId`, `source`, `riskLevel`, `sideEffect`
  (`read-only` | `side-effecting` — cho Replay), `requiresConfirmation`,
  `timeoutMs`, `maxRetries`, `enabled`.
- `ToolResult`: `{ success, data?, error?: { code, message, retryable }, evidence, usage? }`.
  Lỗi **có kiểm soát** ⇒ `success:false` + `error.code` (đừng ném) để agent tự
  xoay hướng. `evidence` được `finalize` gom để verify grounding/citation.
- `ToolExecutionContext`: `{ runId, stepId, providerId, userId?, tenantId?, signal, logger, metadata? }`.
  Huỷ (timeout/cancel/vượt ngân sách) ⇒ `signal` bị abort.

## Thêm một Local Tool

1. Class trong `src/tools/impl/` (dùng `localToolDefinition` helper cho metadata
   mặc định an toàn: low risk, read-only).
2. Wire trong `src/tools/tools.module.ts`: thêm class vào `providers` và
   `inject:` của `LOCAL_AGENT_TOOLS`.
3. `.spec.ts` cạnh file.
4. **Không** sửa `src/agent/`. Registry tự gom lúc boot.

## Retry & lỗi

`tool.node` bọc `withRetry(withTimeout(execute))`. Chỉ retry khi
`result.error.retryable === true` và còn lượt (`metadata.maxRetries`). Phân loại:

| Loại lỗi | `code` gợi ý | retryable |
| --- | --- | --- |
| args sai schema | `TOOL_ARGUMENT_ERROR` | ✖ |
| timeout | `TOOL_TIMEOUT` | ✅ |
| hạ tầng tạm thời (mạng, service down) | `TOOL_EXECUTION_ERROR` / `RAG_RETRIEVAL_ERROR` | ✅ |
| permission | `PERMISSION_DENIED` | ✖ |
| business validation | `TOOL_EXECUTION_ERROR` (retryable:false) | ✖ |

## Tool có side effect (backlog)

Đặt `metadata.sideEffect: 'side-effecting'` + `requiresConfirmation: true`.
Hiện `tool.node` **từ chối** high-risk tool (chưa có nhánh HITL). Replay không
bao giờ blind-replay side-effecting tool.
