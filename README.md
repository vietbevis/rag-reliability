# RAG Reliability Service

Hệ thống RAG **production-grade, độ tin cậy cao**. Mục tiêu duy nhất: LLM trả
lời **đúng khi có evidence** và **từ chối (`INSUFFICIENT_EVIDENCE`) khi không
có** — không đoán, không bịa, không tạo citation giả. Mọi tối ưu phải được
chứng minh bằng benchmark (baseline → experiment → regression).

> Đây **không** phải chatbot business. Trọng tâm: Data Quality → Chunking →
> Embedding → Retrieval → Reranking → Grounding → Citation → Faithfulness →
> Hallucination Detection → Evaluation → Regression Benchmark.

## Stack

NestJS 11 · TypeScript (strict) · PostgreSQL + pgvector · Prisma 7 (generator
`prisma-client` + driver adapter `@prisma/adapter-pg`) · LangChain.js /
LangGraph.js · Multi-provider LLM (OpenAI · Gemini · Anthropic · Custom) ·
`@firecrawl/anydoc` (parsing) · Docker Compose · Jest.

## Trạng thái: PHASE 0-6 ✅

| Có sẵn                                                                                                              | Chưa (phase sau)                                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Config validate bằng Zod, health check (`/health` gồm pgvector + neo4j)                                             | Reranking (P7)                                       |
| Prisma 7 + schema đầy đủ + migration + pgvector                                                                     | Grounded generation nghiêm ngặt + abstention (P8)    |
| Tầng AI đa provider: 5 LLM + 4 embedding (gồm `fake`), đổi bằng env                                                 | Citation cấp claim / faithfulness (P9-10)            |
| Token counting, cost estimation theo provider, retry/timeout/phân loại lỗi                                          | Evaluation framework đầy đủ / regression / obs (P11-12) |
| Parser: anydoc (chính) + plaintext/html (fallback)                                                                  |                                                     |
| **Ingestion**: normalize → clean → dedup → quality gate, có trace                                                   |                                                     |
| **Chunking**: structure-aware (Markdown) + fixed (baseline), chunk quality, đổi bằng env                            |                                                     |
| **Embedding**: đa provider (openai/gemini/custom/fake) + pgvector + HNSW cosine index, batch, cost tracking         |                                                     |
| **Baseline RAG (P4)**: vector retrieval → context builder (token budget) → context validation → grounded generation (structured output + `schema.parse` server-side) → citation map thô → `RagQuery` trace |          |
| **Graph RAG — construction (P5)**: Neo4j entity/relation graph, extraction LLM + gleaning, cache hash, cleanup doc |                                                     |
| **Retrieval nâng cao (P6)**: keyword (PG full-text) · graph traversal (3-tier entity linking, degree-cap, circuit-breaker) · hybrid + fusion (RRF/weighted) · `strategy` per-request |          |
| **API RAG**: `POST /rag/search` · `POST /rag/query` — nhận `strategy: vector\|keyword\|graph\|hybrid`             |                                                     |
| **Evaluation harness (P4)**: golden dataset + retrieval metrics (Recall@K/MRR/NDCG…) + generation metrics (abstention/correctness) + baseline `EvaluationRun` |          |
| **API tài liệu**: upload → ingest → chunk → embed (tới `COMPLETED`) + `GET /documents/:id/{chunks,embeddings,jobs}` |                                                     |
| `GET /ai/providers`, `POST /ai/providers/test`                                                                      |                                                     |
| **API graph (P5)**: `POST/GET /documents/:id/graph` · `DELETE /documents/:id` (dọn Neo4j) · `POST /graph/reconcile` |                                                     |
| Docker Compose (app + postgres + neo4j), Dockerfile multi-stage                                                     |                                                     |
| 269 unit test + 43 e2e/integration test (8 graph e2e chỉ chạy khi bật Neo4j)                                        |                                                     |

Chi tiết: [`docs/architecture/rag-architecture.md`](docs/architecture/rag-architecture.md),
[`docs/architecture/graph-rag.md`](docs/architecture/graph-rag.md),
[`docs/architecture/llm-providers.md`](docs/architecture/llm-providers.md),
[`docs/rag/document-parsing.md`](docs/rag/document-parsing.md),
[`docs/rag/data-cleaning.md`](docs/rag/data-cleaning.md),
[`docs/rag/chunking.md`](docs/rag/chunking.md),
[`docs/rag/embedding.md`](docs/rag/embedding.md),
[`docs/rag/retrieval.md`](docs/rag/retrieval.md),
[`docs/rag/grounding.md`](docs/rag/grounding.md),
[`docs/evaluation/metrics.md`](docs/evaluation/metrics.md),
[`docs/evaluation/experiments.md`](docs/evaluation/experiments.md).

## Bắt đầu

### Yêu cầu

- Node.js **>= 24**
- Docker + Docker Compose

### Chạy local (app ngoài Docker, DB trong Docker)

```bash
cp .env.example .env          # điền OPENAI_API_KEY (hoặc provider khác)
npm install
docker compose up -d postgres # PostgreSQL + pgvector
npm run prisma:generate
npm run prisma:migrate        # áp migration (tạo extension vector + bảng)
npm run start:dev
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs
- Health: http://localhost:3000/health

### Chạy toàn bộ bằng Docker

```bash
cp .env.example .env
docker compose up -d --build   # app tự chạy `prisma migrate deploy` khi khởi động
curl localhost:3000/health
```

## Lệnh

| Lệnh                                | Việc                                          |
| ----------------------------------- | --------------------------------------------- |
| `npm run start:dev`                 | chạy watch mode                               |
| `npm run build`                     | `nest build`                                  |
| `npm run typecheck`                 | `tsc --noEmit` (strict, không `any`)          |
| `npm run lint`                      | ESLint (`--fix`)                              |
| `npm test`                          | unit test (Jest, ESM)                         |
| `npm run test:e2e`                  | e2e + integration (cần PostgreSQL đang chạy)  |
| `npm run prisma:generate`           | sinh Prisma Client vào `src/generated/prisma` |
| `npm run prisma:migrate`            | `prisma migrate dev`                          |
| `npm run prisma:deploy`             | `prisma migrate deploy` (production)          |
| `npm run prisma:studio`             | Prisma Studio                                 |
| `npm run docker:up` / `docker:down` | quản lý stack                                 |
| `npm run evaluate:retrieval`        | chỉ retrieval metrics trên golden dataset (nhanh, không tốn LLM) |
| `npm run evaluate`                  | eval đầy đủ (retrieval + generation); `--baseline` chốt mốc, exit ≠ 0 khi regression |

## Đổi provider LLM / Embedding

Chỉ sửa `.env`, không sửa code:

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=...
EMBEDDING_DIMENSION=768        # khớp text-embedding-004 — CẦN migration mới cho cột vector
```

- Kiểm tra: `GET /ai/providers` và `POST /ai/providers/test` (`{"provider":"anthropic"}`).
- Không có API key? Đặt `EMBEDDING_PROVIDER=fake` (embedding tất định, chỉ cho
  dev/CI) để chạy được toàn bộ pipeline.
- Đổi `EMBEDDING_DIMENSION` phải kèm migration đổi cột `vector(N)` — xem
  [`docs/rag/embedding.md`](docs/rag/embedding.md).

## Graph RAG (tuỳ chọn)

Graph RAG là tính năng tuỳ chọn lưu trữ đồ thị thực thể và quan hệ trên Neo4j.

1. **Khởi động Neo4j** (sử dụng compose profile `graph`):
   ```bash
   docker compose --profile graph up -d neo4j
   ```
   > Để truy cập Neo4j Browser UI tại `http://localhost:7474` khi dev:
   > `cp docker-compose.override.yml.example docker-compose.override.yml`

2. **Kích hoạt trong `.env`**:
   ```env
   GRAPH_RAG_ENABLED=true
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=neo4jlocalpass
   ```
   Khi `GRAPH_RAG_ENABLED=true`, pipeline ingestion sẽ tự động chạy stage `GRAPH` (sau embedding) để trích xuất thực thể/quan hệ bằng LLM (có gleaning + cache hash) và nạp vào Neo4j. Chi tiết: [`docs/architecture/graph-rag.md`](docs/architecture/graph-rag.md).

## Ingest tài liệu

```bash
# Upload file (docx/pdf/xlsx/csv/... qua anydoc, hoặc txt/md/html)
curl -F "file=@bao-cao.docx" -F "title=Báo cáo" -F "source=phòng ĐT" \
  http://localhost:3000/documents

# Hoặc gửi text trực tiếp
curl -H 'content-type: application/json' \
  -d '{"title":"Quy chế","source":"test","text":"# Quy chế..."}' \
  http://localhost:3000/documents

curl http://localhost:3000/documents/<id>            # chi tiết (đã clean)
curl http://localhost:3000/documents/<id>/jobs       # các stage + thời gian
curl http://localhost:3000/documents/<id>/chunks     # danh sách chunk
curl http://localhost:3000/documents/<id>/embeddings # tóm tắt embedding
curl -X POST http://localhost:3000/documents/<id>/ingest  # chạy lại toàn bộ pipeline
curl -X POST http://localhost:3000/documents/<id>/embed -d '{"provider":"gemini"}'  # re-embed
```

Pipeline: `PARSE → NORMALIZE → CLEAN → DEDUPLICATE → QUALITY → CHUNK → EMBED`.
Kết quả: `COMPLETED` (đi hết pipeline, đã có vector) · `CHUNKING` (chưa cấu hình
provider embedding) · `REJECTED` (trùng lặp / chất lượng kém) · `FAILED` (parse
lỗi). Xem [`docs/rag/data-cleaning.md`](docs/rag/data-cleaning.md),
[`docs/rag/chunking.md`](docs/rag/chunking.md),
[`docs/rag/embedding.md`](docs/rag/embedding.md).

## Truy vấn RAG (PHASE 4)

```bash
# Chỉ retrieval — kiểm tra "có kéo đúng chunk không" mà không tốn LLM (§40)
curl -H 'content-type: application/json' \
  -d '{"query":"Sinh viên được bảo lưu tối đa bao lâu?","topK":5,
       "filters":{"sources":["quy-che-dao-tao"]}}' \
  http://localhost:3000/rag/search

# Pipeline đầy đủ: retrieve → context → validate → generate
curl -H 'content-type: application/json' \
  -d '{"query":"Sinh viên được bảo lưu tối đa bao lâu?","topK":5}' \
  http://localhost:3000/rag/query
```

`POST /rag/query` trả `{ answer, status, citations, retrieval, provider, model, usage, latencyMs }`.
`status`:

- `GROUNDED` / `PARTIALLY_GROUNDED` — trả lời có căn cứ trong context.
- `INSUFFICIENT_EVIDENCE` — abstain. Baseline **chỉ** abstain khi context rỗng
  (cố ý, để đo hallucination rate — §35); PHASE 7-9 siết bằng
  `RAG_MIN_RELEVANCE`, conflicting-evidence, faithfulness verifier.
- `ERROR` — lỗi hạ tầng (LLM down…): response vẫn **200** kèm `error`, không 500;
  `RagQuery.error` được ghi, chạy lại được.

Không có API key? `LLM_PROVIDER=fake EMBEDDING_PROVIDER=fake` chạy được toàn bộ
pipeline (tất định, chỉ cho dev/CI). Xem
[`docs/rag/retrieval.md`](docs/rag/retrieval.md),
[`docs/rag/grounding.md`](docs/rag/grounding.md).

## Cấu trúc

```
src/
├── config/           # ConfigModule + env.schema.ts (Zod)
├── database/          # PrismaService (Prisma 7 + adapter-pg)
├── ai/{llm,embeddings,reranking,tokenizer}/
├── documents/         # upload/CRUD + parsers/ (anydoc + fallback)
├── rag/ingestion/     # normalize · clean · dedup · quality · orchestrator
├── rag/chunking/      # structure-aware | fixed · chunk quality · factory
├── rag/embedding/     # orchestrator chunk→pgvector + kiểm tra vector schema
├── rag/retrieval/     # Retriever interface · VectorRetriever · RetrievalService
├── rag/context/       # ContextBuilder (token budget) · ContextValidator (abstain gate)
├── rag/grounding/     # AnswerGeneration (structured output + schema.parse)
├── rag/pipeline/      # RagPipelineService (retrieve→context→validate→generate→persist)
├── evaluation/        # golden dataset · metrics · EvaluationRun · CLI
├── common/{errors,types,utils,constants}/
└── health/
prisma/                # schema.prisma + migrations
evaluation/datasets/   # golden dataset *.jsonl
docs/architecture/     # rag-architecture.md, llm-providers.md
docs/rag/              # document-parsing.md, data-cleaning.md, chunking.md, embedding.md, retrieval.md, grounding.md
docs/evaluation/       # metrics.md, experiments.md
```
