# MCP Integration

> **MCP không phải tool-type đặc biệt — MCP là một Tool Provider.** Agent Core
> (`src/agent/`) không bao giờ biết. Chỉ `src/tools/providers/mcp/` biết
> `@modelcontextprotocol/sdk`.

## Kiến trúc

```
MCP server ── MCP protocol ──▶ SdkMcpClient   (chỗ DUY NHẤT import SDK)
                                    │  stdio | sse | streamable-http
                                    ▼
                              MCPToolProvider
                                    │  init → connect → listTools → adapt schema
                                    │  execute → callTool → normalize error (MCP_*)
                                    │  healthCheck → ping ; refresh → re-listTools
                                    ▼
                              ToolRegistryService  (gom với LocalToolProvider)
                                    ▼
                              Agent  (không thấy type MCP SDK)
```

Files: `mcp-tool.provider.ts`, `sdk-mcp-client.ts`, `mcp-schema.adapter.ts`
(JSON Schema → Zod), `mcp-error.adapter.ts`, `mcp-client.port.ts`,
`fake-mcp-client.ts` (mock cho test/benchmark).

## Thêm một MCP server — 6 bước, KHÔNG sửa Agent Core

1. **Configure provider** — `.env`:
   ```
   MCP_ENABLED=true
   MCP_SERVERS=[{"id":"actvn-mcp","transport":"streamable-http",
     "url":"https://actvn-mcp.example.com/mcp",
     "headers":{"Authorization":"Bearer ${ACTVN_MCP_TOKEN}"},
     "defaultRiskLevel":"medium"}]
   ```
   - `id`: kebab-case, dùng làm namespace tool (`actvn-mcp.student_search`).
   - `transport`: `stdio` (cần `command`, `args?`, `env?`) | `sse` | `streamable-http` (cần `url`, `headers?`).
   - `defaultRiskLevel`: trần rủi ro — **không** tin server tự khai `low`.
   - Secrets: inject qua `${ENV}` ở tầng deploy, **không commit**.

2. **Connect** — tự động lúc boot. `ToolsModule` dựng `MCPToolProvider` cho mỗi
   server `enabled`. `ToolRegistryService.onModuleInit` → `provider.init()`
   (connect + `listTools`). Lỗi connect ⇒ log ERROR, provider `unavailable`,
   agent vẫn chạy với tool còn lại.

3. **Discover tools** — `MCPToolProvider` gọi `client.listTools()`, mỗi tool qua
   `mcpToolToDefinition`: JSON Schema → Zod, id `= <providerId>.<name>`,
   `riskLevel` từ `defaultRiskLevel` (hoặc `high` nếu `destructiveHint`),
   `sideEffect` từ `readOnlyHint`.

4. **Registry exposes tools** — `ToolRegistryService` gom cùng `LocalToolProvider`.
   Collision `toolId` giữa 2 provider ⇒ giữ provider đầu + WARN (xem
   `providers health`).

5. **Agent automatically sees tools** — `registry.resolve(allowlist)` gồm tool
   MCP; LLM nhận `ToolSpec` với tên hàm đã sanitize (`actvn-mcp__student_search`).
   Không có `if provider == 'mcp'` ở đâu cả.

6. **Benchmark them** — thêm case category `mcp-*` với `mcpProviders` **mock**
   (`FakeMcpClient` qua `MCPToolProvider` thật). Xem
   `benchmarks/agent/datasets/mcp.jsonl`. Server thật = suite tích hợp riêng.

## Kiểm tra

```
npm run agent:cli -- providers health
npm run agent:cli -- tools list --provider actvn-mcp
npm run agent:cli -- tools inspect actvn-mcp.student_search
npm run agent:cli -- providers refresh actvn-mcp    # sau khi server đổi tool
npm run agent:cli -- run "Sinh viên Nguyễn Văn An học lớp nào?"
```

## Chuẩn hoá lỗi (PROMPT §13)

| Tình huống | `ToolError.code` | retryable |
| --- | --- | --- |
| connect refused / socket hang up | `MCP_CONNECTION_ERROR` | ✅ |
| request timeout | `MCP_TIMEOUT` | ✅ |
| JSON-RPC −32601 | `TOOL_NOT_FOUND` | ✖ |
| JSON-RPC −32602 | `TOOL_ARGUMENT_ERROR` | ✖ |
| JSON-RPC ≤ −32000 khác | `MCP_PROTOCOL_ERROR` | ✖ |
| tool trả `isError: true` | `MCP_REMOTE_ERROR` | ✖ |

`tool.node` retry lời gọi khi `error.retryable && attempt < maxRetries`
(`MCP_TOOL_MAX_RETRIES`, mặc định 1). Lỗi non-retryable feed lại model để tự
xoay hướng.

## Bảo mật (PROMPT §14)

- Tool output = **untrusted** — bọc `<tool_result trusted="false">`, system
  prompt nêu rõ, `finalize` không để tool output định đoạt status.
- `destructiveHint` → `riskLevel: high` → `requiresConfirmation: true` →
  `tool.node` **từ chối** (`PERMISSION_DENIED`) — HITL approval là backlog.
- `defaultRiskLevel` là trần: server khai `readOnlyHint` không hạ được risk
  xuống dưới config.
