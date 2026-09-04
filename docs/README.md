# Tài liệu — bản đồ

Điểm vào cho đồng nghiệp mới. Cài đặt & chạy: [`../README.md`](../README.md).

---

## Bắt đầu từ đâu

| Bạn muốn… | Đọc |
| --- | --- |
| Cài đặt + chạy lên | [`../README.md`](../README.md) |
| Hiểu kiến trúc agent hiện hành (đầy đủ, có how-to) | [`architecture/implementation-report.md`](architecture/implementation-report.md) |
| Hiểu kiến trúc RAG | [`architecture/rag-architecture.md`](architecture/rag-architecture.md) |
| Thêm một local tool cho agent | [`tools/README.md`](tools/README.md) |
| Kết nối một MCP server (không sửa code) | [`mcp/README.md`](mcp/README.md) |
| Thêm một benchmark case cho agent | [`benchmark/README.md`](benchmark/README.md) + implementation-report §18 |
| Debug một truy vấn RAG | [`architecture/observability.md`](architecture/observability.md) |

---

## `architecture/`

| File | Nội dung |
| --- | --- |
| [`implementation-report.md`](architecture/implementation-report.md) | **Nguồn chính** cho Agent Reliability Platform (PHASE 18) — 18 mục: kiến trúc cũ/đích, changes, agent flow, tool/provider/MCP/RAG/evaluation/benchmark/observability/replay, tests, giới hạn, how-to thêm tool / MCP server / benchmark case |
| [`current-state.md`](architecture/current-state.md) | Audit codebase trước đợt refactor agent (14 vấn đề P1–P14) |
| [`target-state.md`](architecture/target-state.md) | Kiến trúc đích: Agent Core → Tool Runtime → Registry → Providers (Local/MCP/Future) |
| [`agent-tools.md`](architecture/agent-tools.md) | Quyết định thiết kế PHASE 17 (nền của PHASE 18 — có pointer ở đầu file) |
| [`rag-architecture.md`](architecture/rag-architecture.md) | Kiến trúc RAG Reliability Service — pipeline, module, nguyên tắc |
| [`llm-providers.md`](architecture/llm-providers.md) | `LLMProvider` abstraction đa provider (openai/gemini/anthropic/custom/fake) |
| [`graph-rag.md`](architecture/graph-rag.md) | Graph RAG (Neo4j) — entity/relation extraction, graph retriever |
| [`observability.md`](architecture/observability.md) | Trace RAG từng chặng + `trace-sanitizer` (redaction). Agent có `Tracer` interface riêng — xem implementation-report §11 |
| [`regression.md`](architecture/regression.md) | Regression gate RAG (ngưỡng, baseline promotion, CI). Agent gate: `benchmark/README.md` |

## `tools/`, `mcp/`, `benchmark/`

| File | Nội dung |
| --- | --- |
| [`tools/README.md`](tools/README.md) | Hợp đồng `AgentTool` · cách thêm local tool · retry & phân loại lỗi · tool side-effect |
| [`mcp/README.md`](mcp/README.md) | MCP = một Tool Provider · thêm MCP server 6 bước không sửa Agent Core · chuẩn hoá lỗi `MCP_*` · trust boundary |
| [`benchmark/README.md`](benchmark/README.md) | Chạy `benchmark:agent` · case schema 15 category · mock env deterministic · regression + thresholds |

## `rag/`

Chi tiết từng chặng pipeline RAG: [`data-cleaning`](rag/data-cleaning.md) ·
[`document-parsing`](rag/document-parsing.md) · [`chunking`](rag/chunking.md) ·
[`embedding`](rag/embedding.md) · [`retrieval`](rag/retrieval.md) ·
[`reranking`](rag/reranking.md) · [`grounding`](rag/grounding.md) ·
[`citation`](rag/citation.md) · [`faithfulness`](rag/faithfulness.md).

## `evaluation/`

RAG evaluation: [`metrics`](evaluation/metrics.md) (định nghĩa chỉ số) ·
[`experiments`](evaluation/experiments.md) (exp-001..007 before/after) ·
[`benchmarks`](evaluation/benchmarks.md) (multi-provider / strategy).

Agent evaluation (10 evaluator, trajectory) — xem
[`architecture/implementation-report.md`](architecture/implementation-report.md) §8-9.

## `audit/`

Đợt audit RAG bên ngoài (agy) + khắc phục. Bắt đầu:
[`EXECUTIVE_SUMMARY.md`](audit/EXECUTIVE_SUMMARY.md) →
[`REMEDIATION.md`](audit/REMEDIATION.md) (những gì đã sửa).
