# RAG Reliability Service — Agent Reliability Platform

Hai thứ trong một repo:

1. **RAG service production-grade** — LLM trả lời **đúng khi có evidence**, **từ
   chối (`INSUFFICIENT_EVIDENCE`) khi không có**. Không đoán, không bịa, không
   citation giả. Mọi tối ưu chứng minh bằng benchmark (baseline → experiment →
   regression).
2. **Agent Reliability Platform** — Agent Runtime + Tool Runtime, trong đó **RAG
   là một Tool**, **local tool là Tool**, **MCP tool là Tool qua MCP Provider**;
   Agent Core không biết tool đến từ đâu. Kèm evaluator framework, benchmark 24
   case, observability, replay, failure taxonomy.

> Không phải chatbot. Trọng tâm: đo được độ tin cậy và bắt được regression khi
> đổi model / tool / prompt / MCP server.

## Mục lục

1. [Kiến trúc](#kiến-trúc)
2. [Yêu cầu & cài đặt nhanh](#yêu-cầu--cài-đặt-nhanh)
3. [Cấu hình `.env`](#cấu-hình-env)
4. [LLM + embedding provider](#llm--embedding-provider)
5. [Ingest tài liệu](#ingest-tài-liệu)
6. [Truy vấn RAG](#truy-vấn-rag)
7. [Agent Reliability Platform](#agent-reliability-platform)
8. [Đánh giá & benchmark](#đánh-giá--benchmark)
9. [Kết quả benchmark thực đo](#kết-quả-benchmark-thực-đo)
10. [Vận hành production](#vận-hành-production)
11. [Lệnh tra cứu nhanh](#lệnh-tra-cứu-nhanh)
12. [Xử lý sự cố](#xử-lý-sự-cố)
13. [Cấu trúc thư mục](#cấu-trúc-thư-mục)
14. [Tài liệu](#tài-liệu)

---

## Kiến trúc

**Stack:** NestJS 11 · TypeScript strict (không `any`) · PostgreSQL 16 + pgvector
(HNSW cosine, `vector(1024)`) · Prisma 7 (driver adapter `@prisma/adapter-pg`) ·
Redis 7 + BullMQ (queue) · Neo4j 5 (graph RAG, tuỳ chọn) · LangChain.js +
LangGraph · `@modelcontextprotocol/sdk` (MCP) · `@firecrawl/anydoc` · Jest (ESM).

### RAG pipeline

```
Ingest:  Upload → PARSE → NORMALIZE → CLEAN → DEDUPLICATE → QUALITY GATE
                → CHUNK → EMBED (pgvector) → GRAPH (tuỳ chọn)          [BullMQ nền]

Query:   query → retrieve (vector|keyword|graph|hybrid + RRF/weighted fusion)
               → rerank (tuỳ chọn) → context build → context validation (abstain gate)
               → generate (structured JSON + schema.parse) → evidence matching
               → faithfulness verifier → numeric-provenance → citation build
               → persist RagQuery + trace
```

`RagStatus`: `GROUNDED` / `PARTIALLY_GROUNDED` / `INSUFFICIENT_EVIDENCE` (abstain)
/ `CONFLICTING_EVIDENCE` / `ERROR` (lỗi hạ tầng — vẫn HTTP 200 kèm `error`).

### Agent runtime

```
User Query → Agent Runtime (LangGraph loop)
           → Tool Runtime (execute + retry + risk gate + timeout)
           → Tool Registry ─┬─ LocalToolProvider  (rag.search · calculator · current_time)
                            └─ MCPToolProvider    (actvn-mcp · …  — từ config, không sửa code)
           → finalize.node (verify grounding/citation/faithfulness, dùng chung RAG)
           → AgentRun + trace + failureClass

Trace ──▶ Evaluation · Benchmark · Observability (Tracer interface) · Replay
```

Agent Core (`src/agent/`) **không** import tool impl, MCP SDK, Langfuse hay
benchmark. Thêm 1 tool hoặc 1 MCP server ⇒ **0 dòng** sửa `src/agent/`.

Tài liệu: [`docs/README.md`](docs/README.md) (bản đồ toàn bộ tài liệu).

---

## Yêu cầu & cài đặt nhanh

- **Node.js ≥ 24**
- **Docker + Docker Compose** — PostgreSQL + pgvector (bắt buộc), Redis (queue,
  nên có), Neo4j (graph RAG, tuỳ chọn)
- **LLM + embedding**: một endpoint OpenAI-compatible. Hai lựa chọn:
  - **API bên thứ 3** (b.ai / OpenAI / …) — chỉ cần base URL + API key + model
  - **[Ollama](https://ollama.com)** chạy local — không cần key

```bash
git clone <repo> && cd rag-reliability
npm install
cp .env.example .env            # xem mục "Cấu hình .env"

# hạ tầng
docker compose up -d postgres redis          # + neo4j nếu GRAPH_RAG_ENABLED=true

# schema
npm run prisma:generate
npm run prisma:deploy                         # áp toàn bộ 13 migration

# chạy
npm run start:dev
```

- API: <http://localhost:3000>
- **Test console** (form UI cho MỌI endpoint — RAG + Agent): <http://localhost:3000/console>
- Swagger: <http://localhost:3000/docs> · Health: <http://localhost:3000/health>

### Bật Agent

Agent bị tắt mặc định. Trong `.env`:

```env
AGENT_ENABLED=true
QUEUE_ENABLED=false        # sync — đơn giản để test; true = async qua BullMQ
```

Rồi mở console → tab **Agent**, hoặc:

```bash
curl -XPOST localhost:3000/agent/run -H 'content-type: application/json' \
  -d '{"task":"15% của 2.480.000 đồng là bao nhiêu? Dùng công cụ tính.","execution":"sync"}'
```

### Toàn bộ trong Docker

```bash
cp .env.example .env
docker compose up -d --build    # app tự chạy `prisma migrate deploy`
curl localhost:3000/health
```

---

## Cấu hình `.env`

`.env` và `.env.example` có **cùng bộ key** (~124). Toàn bộ mô tả trong
[`.env.example`](.env.example). Các nhóm quan trọng:

### Provider (đổi backend không sửa code)

```env
LLM_PROVIDER=custom          # custom (OpenAI-compatible) | openai | gemini | anthropic | fake
EMBEDDING_PROVIDER=custom    # custom | openai | gemini | fake

# --- Ví dụ: API bên thứ 3 (b.ai) cho LLM, Ollama cho embedding ---
CUSTOM_LLM_BASE_URL=https://api.b.ai/v1
CUSTOM_LLM_API_KEY=sk-...
CUSTOM_LLM_MODEL=glm-5.3-flash          # model hỗ trợ tool-calling native

CUSTOM_EMBEDDING_BASE_URL=http://localhost:11434/v1
CUSTOM_EMBEDDING_API_KEY=ollama
CUSTOM_EMBEDDING_MODEL=zylonai/multilingual-e5-large

# --- Hoặc Ollama cho cả hai ---
# CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
# CUSTOM_LLM_MODEL=qwen2.5:7b
```

> `fake` = provider tất định theo hash — **chỉ CI/test**, không gọi mạng, không
> có ý nghĩa ngữ nghĩa, agent với `fake` KHÔNG gọi tool.

### Embedding & vector dimension

```env
EMBEDDING_DIMENSION=1024      # PHẢI khớp cột vector trong DB — đổi cần migration mới
EMBEDDING_DISTANCE=cosine     # phải khớp opclass HNSW index
EMBEDDING_QUERY_PREFIX=       # để trống → tự thêm "query: " khi model chứa "e5"
EMBEDDING_PASSAGE_PREFIX=     # để trống → tự thêm "passage: "
```

### Agent (PHASE 17-18)

```env
AGENT_ENABLED=false          # true = mở route /agent/* + tab Agent trong console
AGENT_EXECUTION=async         # async (BullMQ, cần QUEUE_ENABLED) | sync
AGENT_MODEL=                  # để trống → dùng CUSTOM_LLM_MODEL
AGENT_FORCE_FIRST_TOOL=true   # ép tool_choice:required lượt đầu (model OSS hay "lười")
AGENT_MAX_STEPS=8             # + MAX_TOOL_CALLS / MAX_WALL_CLOCK_MS / MAX_TOTAL_TOKENS
AGENT_COST_BUDGET_USD=0.10    # trần cứng chống vòng lặp bỏ chạy
AGENT_TOOL_FAILURE_THRESHOLD=4
```

### MCP — tool provider (KHÔNG sửa Agent Core)

```env
MCP_ENABLED=false
# JSON mảng cấu hình MCP server. Secrets inject qua ${ENV} ở tầng deploy.
MCP_SERVERS=[]
# Ví dụ:
# MCP_SERVERS=[{"id":"actvn-mcp","transport":"streamable-http",
#   "url":"https://actvn-mcp.example.com/mcp",
#   "headers":{"Authorization":"Bearer ${ACTVN_MCP_TOKEN}"},"defaultRiskLevel":"medium"}]
# transport: stdio (cần command/args) | sse | streamable-http (cần url)
MCP_TOOL_TIMEOUT_MS=30000
MCP_TOOL_MAX_RETRIES=1
```

Xem [`docs/mcp/README.md`](docs/mcp/README.md).

### Queue / Grounding / Rate limit / Graph — xem `.env.example`

```env
QUEUE_ENABLED=true           # POST /documents → 202 + worker nền; false = inline
GRAPH_RAG_ENABLED=false       # true ⇒ NEO4J_URI + NEO4J_PASSWORD bắt buộc
LANGFUSE_ENABLED=false        # observability best-effort (self-host)
RATE_LIMIT_ENABLED=true       # /rag/* 20/phút · /agent/* 10/phút · còn lại 120
RAG_STRICT_GROUNDING=false
RAG_CITATION_ENABLED=true
RAG_FAITHFULNESS_ENABLED=true
```

---

## LLM + embedding provider

### Ollama local

```bash
ollama serve                                   # cổng 11434
ollama pull qwen2.5:7b                          # LLM (tool-calling: qwen2.5 / llama3.1+)
ollama pull zylonai/multilingual-e5-large       # embedding 1024d, tiếng Việt tốt

curl http://localhost:11434/v1/models
curl -s -XPOST localhost:3000/ai/providers/test -H 'content-type: application/json' \
  -d '{"provider":"custom"}'
```

Model thay thế: LLM `qwen3:8b` / `llama3.1:8b`; embedding `bge-m3` (1024d, không
tiền tố) hoặc `nomic-embed-text` (768d → đổi `EMBEDDING_DIMENSION=768` + migration).

### API bên thứ 3

Chỉ cần `CUSTOM_LLM_BASE_URL` + `CUSTOM_LLM_API_KEY` + `CUSTOM_LLM_MODEL`. Model
cho agent nên hỗ trợ **tool-calling native** (`chatWithTools`). Model bọc
structured output trong ```` ```json ```` (glm, một số vLLM build) được xử lý tự
động: `chatStructured` có fallback gỡ fence.

---

## Ingest tài liệu

```bash
# File (docx/pdf/xlsx/pptx/csv/html/md) — qua anydoc, ≤ 25 MB
curl -F "file=@quy-che-dao-tao.pdf" -F "title=Quy chế đào tạo" -F "source=phong-dt" \
  http://localhost:3000/documents

# Text trực tiếp
curl -H 'content-type: application/json' \
  -d '{"title":"Quy chế bảo lưu","source":"phong-dt","text":"# Quy chế...\n\n## Điều 1..."}' \
  http://localhost:3000/documents

# Theo dõi (QUEUE_ENABLED=true → 202, poll status)
curl localhost:3000/documents/<id>              # status + jobState
curl localhost:3000/documents/<id>/jobs         # từng stage + thời gian
curl localhost:3000/documents/<id>/chunks
```

Bảng trong DOCX/XLSX/PPTX → Markdown GFM chính xác; PDF native-text có kẻ ô tái
tạo tốt; PDF scan → `NEEDS_OCR` (cần `FIRECRAWL_API_KEY` hoặc `ANYDOC_OCR=hosted`).
Chunker `structure` (mặc định) giữ nguyên bảng ≤ 512 token trong một chunk. Chi
tiết: [`docs/rag/`](docs/rag/).

---

## Truy vấn RAG

```bash
# Chỉ retrieval — KHÔNG tốn LLM
curl -H 'content-type: application/json' -d '{
  "query": "Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?",
  "topK": 5, "strategy": "hybrid"
}' http://localhost:3000/rag/search

# Pipeline đầy đủ
curl -H 'content-type: application/json' -d '{
  "query": "Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?",
  "topK": 5, "strategy": "vector", "strict": true, "cite": true, "faithfulness": true
}' http://localhost:3000/rag/query
```

| Trường `POST /rag/query` | Ý nghĩa |
| --- | --- |
| `query` | câu hỏi (bắt buộc) |
| `topK` / `strategy` | số chunk / `vector`\|`keyword`\|`graph`\|`hybrid` |
| `rerank` / `strict` / `cite` / `faithfulness` | ghi đè cờ tương ứng trong `.env` |

Response: `{ id, status, answer, citations[], claims[], faithfulness, retrieval,
provider, model, usage, latencyMs, trace }`.

```bash
curl localhost:3000/rag/queries                 # lịch sử (?status=GROUNDED&take=50)
curl localhost:3000/rag/queries/<id>/trace      # timeline từng chặng
```

---

## Agent Reliability Platform

### Chạy agent

```bash
# .env: AGENT_ENABLED=true
curl -XPOST localhost:3000/agent/run -H 'content-type: application/json' -d '{
  "task": "Một lô hàng 43 thùng, mỗi thùng 27 sản phẩm. Tổng bao nhiêu? Dùng công cụ tính.",
  "toolAllowlist": ["calculator.calculate"],
  "execution": "sync"
}'
```

Response: `{ id, status, finalStatus, answer, citations[], claims[], faithfulness,
toolsUsed[], stepCount, failureClass, latencyMs, ... }`.

| Endpoint | Việc |
| --- | --- |
| `POST /agent/run` | chạy task. `execution: sync\|async`. `toolAllowlist` = canonical id |
| `GET /agent/runs/:id` · `/trace` · `/stream` (SSE) · `/cancel` | theo dõi / huỷ |
| `GET /agent/tools` | mọi tool agent thấy (local + MCP) + metadata |
| `GET /agent/providers` | sức khoẻ từng tool provider + collision |
| `POST /agent/runs/:id/replay` | replay run đã ghi — `{ mode: recorded\|dry-run\|live-read }` |

Console tab **Agent** nạp checkbox tool động từ `/agent/tools` (kể cả MCP).

### CLI quản trị

```bash
npm run agent:cli -- run "câu hỏi"
npm run agent:cli -- tools list [--provider <id>]
npm run agent:cli -- tools inspect <toolId>
npm run agent:cli -- providers list | health | refresh <id>
npm run agent:cli -- replay <agentRunId> [--mode dry-run|recorded|live-read]
```

### Thêm MCP server (không sửa code)

```env
MCP_ENABLED=true
MCP_SERVERS=[{"id":"actvn-mcp","transport":"streamable-http","url":"...","headers":{...}}]
```

Boot → provider connect → discover tool → registry expose → agent tự thấy. Provider
chết ⇒ registry bỏ qua tool của nó, agent vẫn chạy. Chi tiết 6 bước:
[`docs/mcp/README.md`](docs/mcp/README.md).

### Benchmark agent

```bash
npm run benchmark:agent:gen                      # sinh benchmarks/agent/datasets/*.jsonl (24 case)
npm run benchmark:agent                          # chạy tất cả, so baseline, exit≠0 nếu regressed
npm run benchmark:agent -- --case mcp-workflow   # lọc theo id/category
npm run benchmark:agent -- --baseline            # chốt baseline (+ sinh thresholds.suggested.json)
```

Môi trường tool **hoàn toàn mock** (deterministic — canned RAG + mock MCP). Cần
`LLM_PROVIDER=custom` model thật (với `fake` agent không gọi tool). 15 category:
basic · rag · tool-selection · tool-args · multi-step · failure-recovery ·
adversarial · mcp-{discovery,selection,args,execution,failure,provider-failure} ·
cross-provider · mcp-workflow. Chi tiết: [`docs/benchmark/README.md`](docs/benchmark/README.md).

### Thêm tool / hiểu evaluator / failure taxonomy

- Thêm local tool: [`docs/tools/README.md`](docs/tools/README.md)
- Kiến trúc đầy đủ + how-to: [`docs/architecture/implementation-report.md`](docs/architecture/implementation-report.md)

---

## Đánh giá & benchmark

RAG / Agent golden dataset: [`evaluation/datasets/*.jsonl`](evaluation/datasets/)
— **210 case / 13 file**, 39 tài liệu corpus, mỗi case tự mang corpus. Thiết kế
để **tách lỗi theo tầng** (embedding → retriever → reranker → generation →
hallucination → agent routing). Chi tiết: [`docs/evaluation-dataset.md`](docs/evaluation-dataset.md).

```bash
npm run dataset:generate             # sinh lại dataset JSONL (generator gốc + extended)
npm run dataset:validate             # schema Zod + bất biến chất lượng (CI gate)
npm run dataset:stats                # phân bố category / difficulty / language / negative

npm run evaluate:retrieval           # chỉ retrieval metrics (nhanh, KHÔNG LLM)
npm run evaluate -- --baseline       # đầy đủ, chốt mốc
npm run evaluate                     # so baseline, exit ≠ 0 nếu regression
npm run evaluate -- golden semantic --label=exp-e5
npm run evaluate:embeddings          # ma trận đa embedding model (E5 vs Gemini vs …)

# Benchmark before/after (REST)
curl -XPOST localhost:3000/evaluation/benchmark-strategies -d '{"datasetName":"golden"}'
curl -XPOST localhost:3000/evaluation/experiments/exp-003/run -d '{"datasetName":"golden"}'
```

| File | Case | Đo lỗi tầng nào |
| --- | ---: | --- |
| `answerable.jsonl` | 57 | retrieval cơ bản + generation |
| `semantic.jsonl` | 12 | **embedding** — paraphrase + keyword mismatch |
| `numerical.jsonl` | 15 | số / port / version / ngày + temporal reasoning |
| `multi-hop.jsonl` | 18 | nối 2+ chunk |
| `cross-document.jsonl` | 7 | ghép ≥ 3 tài liệu |
| `conflicting.jsonl` | 6 | tài liệu mâu thuẫn / version-aware |
| `unanswerable.jsonl` | 15 | abstention (ngoài phạm vi) |
| `adversarial.jsonl` | 15 | tiền đề sai / số bịa |
| `entity-disambiguation.jsonl` | 8 | thực thể tên gần giống |
| `distractor.jsonl` | 10 | tài liệu nhiễu gần đúng + long-context |
| `vietnamese-robustness.jsonl` | 12 | typo / thiếu dấu / trộn Anh-Việt / khẩu ngữ |
| `agent-routing.jsonl` | 12 | RAG vs tool vs rag_and_tool |
| `golden.jsonl` | 23 | regression suite chất lượng cao |

Chỉ số: retrieval (`recallAt5`, `mrr`, `ndcgAt5`, `contextPrecision/Recall`),
generation (`abstentionAccuracy`, `answerCorrectness`, `requiredFactRecall`,
`forbiddenClaimRate`, `citationAccuracy`, `faithfulness`,
`claimLevelHallucinationRate`), thống kê (`passRate` + CI 95% bootstrap có
seed). Định nghĩa: [`docs/evaluation/metrics.md`](docs/evaluation/metrics.md) ·
[`docs/evaluation-dataset.md`](docs/evaluation-dataset.md).

---

## Kết quả benchmark thực đo

### RAG — 5 dataset, 111 case (Ollama `qwen2.5:7b` + e5-large, 2026-08-29)

| Dataset | N | passRate (95% CI) | Recall@5 | MRR | Faithfulness | Claim Halluc. | Latency P50 |
| --- | --: | --: | --: | --: | --: | --: | --: |
| **answerable** | 57 | 0.77 (0.67–0.88) | **0.991** | **1.00** | **0.983** | 0.018 | 17.8s |
| **multi-hop** | 18 | 0.44 (0.22–0.67) | 0.926 | 0.972 | 0.964 | 0.036 | 18.3s |
| **conflicting** | 6 | **1.00** | **1.00** | 0.833 | 0.833 | 0.167 | 31.8s |
| **adversarial** | 15 | 0.87 (0.67–1.0) | — | — | 0.750 | 0.25 | 6.6s |
| **unanswerable** | 15 | **1.00** | — | — | — | — | 10.3s |

Điểm yếu còn lại (giới hạn model, không phải bug): multi-hop passRate 0.44
(`qwen2.5:7b` yếu suy luận 2-3 chặng); citationAccuracy answerable 0.67 (câu trả
lời faithful nhưng trích chunk lệch tài liệu gold). Model lớn hơn cải thiện đáng kể.

### Agent — 24 case (b.ai `glm-5.3-flash`, 2026-09-04)

| Metric | Giá trị |
| --- | --- |
| taskSuccess | **0.833** (20/24) |
| toolSelectionAccuracy / argumentAccuracy | **1.00** |
| recoveryRate / safetyRate | **1.00** |
| hallucinationRate | **0.042** |
| groundedness / citationAccuracy | 0.754 / 0.783 |
| avgSteps / avgLatencyMs | 6.5 / 79 968 (glm-flash + fallback chậm) |

4 case FAIL — đều `groundedness`/`citation` trên MCP workflow (glm yếu
claim-extract/NLI). Baseline: `benchmarks/agent/results/baseline.json`; ngưỡng
gate hiệu chỉnh: `benchmarks/agent/thresholds.json`.

---

## Vận hành production

### Sau khi pull code mới

```bash
npm install                    # có thể có dependency mới (@modelcontextprotocol/sdk)
npm run prisma:deploy          # áp migration
# migration đụng cột Embedding (vd e5 1024d) ⇒ bảng Embedding bị TRUNCATE →
# phải re-embed: for id in $(...); do curl -XPOST localhost:3000/documents/$id/embed; done
```

### Checklist

- [ ] `NODE_ENV=production`, `SWAGGER_ENABLED=false`, `RATE_LIMIT_ENABLED=true`.
- [ ] **Auth** ở tầng gateway / reverse proxy (repo chưa có guard). `/agent/*`
      tốn kém hơn `/rag/*` — throttle chặt hơn.
- [ ] `DATABASE_URL` Postgres có backup; `prisma migrate deploy` trong release.
- [ ] Redis cho BullMQ (`QUEUE_ENABLED=true`).
- [ ] Provider LLM có giám sát; `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` hợp lý.
- [ ] CI: `npm run evaluate` (RAG) + `npm run benchmark:agent` (agent) — exit ≠ 0
      = chặn merge. Chốt baseline sau mỗi đổi corpus/model/tool.
- [ ] `AGENT_ENABLED` chỉ bật khi cần; MCP server: secrets qua env, không commit.
- [ ] Agent tool high-risk (`riskLevel: high`) bị **từ chối** (`PERMISSION_DENIED`)
      — v1 read-only, chưa có luồng HITL `/approve`.

---

## Lệnh tra cứu nhanh

| Lệnh | Việc |
| --- | --- |
| `npm run start:dev` | watch mode |
| `npm run build` / `typecheck` / `lint` | `nest build` / `tsc --noEmit` / ESLint `--fix` |
| `npm test` / `npm run test:e2e` | unit (Jest ESM) / e2e (cần Postgres + Redis) |
| `npm run prisma:generate` / `:deploy` / `:migrate` / `:studio` | Prisma |
| `npm run eval:datasets:gen` / `evaluate:retrieval` / `evaluate` | RAG eval |
| `npm run benchmark:agent:gen` / `benchmark:agent` | agent benchmark |
| `npm run agent:cli -- <cmd>` | agent CLI (run / tools / providers / replay) |
| `npm run docker:up` / `docker:down` | quản lý stack |

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân & xử lý |
| --- | --- |
| Khởi động cảnh báo `EMBEDDING_DIMENSION không khớp cột vector(N)` | `npm run prisma:deploy`. Đổi model khác số chiều → cần migration mới. |
| `POST /documents` trả `REJECTED` "trùng lặp" cho file mới | Bản trùng trước kẹt EMBEDDING & còn mới (< 15'). Đợi `INGESTION_STALE_AFTER_MS` hoặc `POST /documents/:id/embed` bản cũ. |
| `/rag/query` hoặc `/agent/run` trả `403` | Feature tắt: `RATE_LIMIT`… không phải; kiểm tra `AGENT_ENABLED=true`. |
| `/agent/run` → `failureClass: LLM_ERROR`, `error: "...credit insufficient..."` | API bên thứ 3 hết credit / sai key. Đổi `CUSTOM_LLM_*` hoặc dùng Ollama. |
| `/agent/run` → `chatStructured failed: Unexpected token '\`'` | Model bọc ```` ```json ```` — đã có fallback; nếu vẫn lỗi, cập nhật code hoặc đổi model. |
| `agent/providers` → provider `unavailable` | MCP server không connect được. Kiểm tra `MCP_SERVERS` url/command; agent vẫn chạy với tool còn lại. |
| `status: ERROR`, `error: "...LLM..."` | Provider down. Response vẫn 200. `ollama ps` / `curl localhost:11434/v1/models`. |
| e2e fail `Option 'resolvePackageJsonExports'` (TS5098) | Đã sửa trong `test/jest-e2e.json`; pull code mới. |
| e2e fail `vector dimension mismatch` | Test DB chưa migrate. `npm run prisma:deploy` lên DB test. |
| eval `⚠ corpus chưa sẵn sàng` | Provider embedding chưa cấu hình khi seed. Cấu hình `EMBEDDING_PROVIDER` rồi chạy lại. |

---

## Cấu trúc thư mục

```
src/
├── config/            env.schema.ts (Zod) + configuration.ts (AppConfig có kiểu)
├── database/          PrismaService (Prisma 7 + adapter-pg)
├── ai/{llm,embeddings,reranking,tokenizer}/    LLMProvider abstraction (openai/gemini/anthropic/custom/fake)
├── common/            rate-limit · utils · errors · observability/trace-sanitizer · types
├── documents/         upload/CRUD + parsers/ + pipeline/ (BullMQ worker)
├── rag/
│   ├── ingestion/ chunking/ embedding/ retrieval/ context/ graph/ pipeline/
│   └── grounding/     answer-generation · claim-extractor · evidence-matcher
│                      · faithfulness · citation · answer-verification · grounding-resolution
├── agent/             Agent Core (LangGraph) — KHÔNG import tool impl / MCP / Langfuse
│   ├── graph/{nodes,guards}/    agent ⇄ tool ⇄ finalize loop + budget/loop/failure guards
│   ├── agent.service.ts · agent.controller.ts · queue/ (BullMQ async)
├── tools/             Tool Runtime
│   ├── core/          ToolDefinition · ToolResult · ToolError · failure taxonomy
│   ├── registry/      ToolRegistryService (đa provider, collision, spec-name)
│   ├── providers/{local,mcp}/   LocalToolProvider · MCPToolProvider · SdkMcpClient · FakeMcpClient
│   └── impl/          rag-search · calculator · current-time
├── observability/     Tracer interface + NoopTracer + LangfuseTracer adapter
├── evaluation/
│   ├── datasets/ metrics/ experiments/ cli/    (RAG eval)
│   └── agent/         trajectory-view · expectation · 10 evaluator
├── benchmark/         agent-case.schema · runner · regression · mock/ · cli/
├── replay/            ReplayService · ReplayToolProvider · ReplayController
├── cli/               agent-cli.ts
└── health/

prisma/migrations/     13 migration (mới nhất: phase18_agent_platform)
evaluation/datasets/   golden dataset RAG/agent *.jsonl (210 case / 13 file)
evaluation/embedding-matrix.json   ma trận benchmark đa embedding model
benchmarks/agent/      datasets/ (24 case) · results/{baseline,thresholds}.json
benchmarks/embedding/  kết quả evaluate:embeddings
scripts/               gen-eval-datasets.mjs · gen-agent-benchmark.mjs
docs/                  xem docs/README.md
```

---

## Tài liệu

Bản đồ đầy đủ: **[`docs/README.md`](docs/README.md)**. Điểm vào:

| Chủ đề | File |
| --- | --- |
| Kiến trúc hiện hành (18 mục, how-to) | [`docs/architecture/implementation-report.md`](docs/architecture/implementation-report.md) |
| Audit → đích của đợt refactor agent | [`docs/architecture/current-state.md`](docs/architecture/current-state.md) · [`target-state.md`](docs/architecture/target-state.md) |
| Thêm local tool | [`docs/tools/README.md`](docs/tools/README.md) |
| Thêm MCP server | [`docs/mcp/README.md`](docs/mcp/README.md) |
| Agent benchmark | [`docs/benchmark/README.md`](docs/benchmark/README.md) |
| RAG pipeline (từng chặng) | [`docs/rag/`](docs/rag/) · [`docs/architecture/rag-architecture.md`](docs/architecture/rag-architecture.md) |
| RAG evaluation / experiments / metrics | [`docs/evaluation/`](docs/evaluation/) |
| Graph RAG | [`docs/architecture/graph-rag.md`](docs/architecture/graph-rag.md) |
| Đợt khắc phục audit RAG | [`docs/audit/REMEDIATION.md`](docs/audit/REMEDIATION.md) |
