# Agent Benchmark

> Trả lời: **Agent có làm đúng không? Sai ở đâu? Version mới có làm reliability
> giảm không?** Môi trường tool **hoàn toàn mock** (deterministic, nhanh, lặp
> lại — PROMPT §29). Benchmark với RAG/MCP server THẬT là suite riêng.

## Chạy

```
npm run benchmark:agent                       # tất cả case, so baseline, exit≠0 nếu regressed
npm run benchmark:agent -- --case mcp-workflow # lọc theo id hoặc category
npm run benchmark:agent -- --baseline          # chốt kết quả này làm baseline
npm run benchmark:agent -- --no-gate           # không exit≠0 khi regressed
npm run benchmark:agent:gen                     # sinh lại datasets từ scripts/gen-agent-benchmark.mjs
```

Cần `LLM_PROVIDER=custom` + `CUSTOM_LLM_*` (model tool-calling THẬT). Với
`LLM_PROVIDER=fake` agent không gọi tool → benchmark vô nghĩa (chỉ
`agent-benchmark.runner.spec.ts` chạy với fake có script).

Output: `benchmarks/agent/results/{latest,baseline,diff}.json`.

## Cấu trúc

```
Benchmark → Dataset (jsonl) → Case → buildCaseRegistry (mock) → AgentGraphBuilder
  → TrajectoryView → Evaluator[] → điểm → Report → compareToBaseline → gate
```

- **Case schema**: `src/benchmark/agent-case.schema.ts` (Zod). 15 category.
- **Mock tool env**: `CannedRagSearchTool` (chunk theo keyword) + `mcpProviders`
  qua `FakeMcpClient` + `MCPToolProvider` thật (chỉ transport fake).
- **Evaluators** theo category (`defaultEvaluators`) — override bằng field
  `evaluators`.
- **Regression** (`regression.ts`): ngưỡng tuyệt đối + sụt so baseline. Config:
  `benchmarks/agent/thresholds.json` (partial `RegressionThresholds`).
- Khi chạy `--baseline`, CLI cũng ghi `thresholds.suggested.json` (= baseline −
  margin). Copy sang `thresholds.json` để gate hoạt động như **regression
  detector** thay vì ngưỡng lý tưởng cứng (dùng khi model chưa đạt bar tuyệt đối).

## Metrics báo cáo

`taskSuccess`, `avgScore`, `toolSelectionAccuracy`, `argumentAccuracy`,
`groundedness`, `citationAccuracy`, `hallucinationRate`, `recoveryRate`,
`safetyRate`, `avgSteps`, `avgToolCalls`, `avgLatencyMs`, `totalTokens` +
`byCategory` + `byFailureClass` (agent fail vì đâu — không chỉ score=0).

## Ngưỡng mặc định

```
taskSuccess ≥ 0.85   toolSelectionAccuracy ≥ 0.90   argumentAccuracy ≥ 0.90
groundedness ≥ 0.85  citationAccuracy ≥ 0.80        hallucinationRate ≤ 0.05
recoveryRate ≥ 0.80  safetyRate ≥ 1.0               avgLatencyMs ≤ 1.5× baseline
```

## Thêm case

Xem `docs/architecture/implementation-report.md §18`.

## MCP benchmark bắt buộc (PROMPT §28) — category

`mcp-discovery` · `mcp-selection` · `mcp-args` · `mcp-execution` · `mcp-failure`
· `mcp-provider-failure` · `cross-provider` (local `rag.search` vs
`actvn-mcp.student_search`) · `mcp-workflow` (`student_search → student_detail →
rag.search → final`).
