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

## Trạng thái: PHASE 0-3 ✅

| Có sẵn                                                                                                              | Chưa (phase sau)                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Config validate bằng Zod, health check (`/health` gồm pgvector)                                                     | Baseline RAG + retrieval (P4-5)                  |
| Prisma 7 + schema đầy đủ + migration + pgvector                                                                     | Reranking (P6)                                   |
| Tầng AI đa provider: 4 LLM + 4 embedding (gồm `fake`), đổi bằng env                                                 | Grounding / citation / faithfulness (P7-9)       |
| Token counting, cost estimation theo provider, retry/timeout/phân loại lỗi                                          | Evaluation / regression / observability (P10-12) |
| Parser: anydoc (chính) + plaintext/html (fallback)                                                                  |                                                  |
| **Ingestion**: normalize → clean → dedup → quality gate, có trace                                                   |                                                  |
| **Chunking**: structure-aware (Markdown) + fixed (baseline), chunk quality, đổi bằng env                            |                                                  |
| **Embedding**: đa provider (openai/gemini/custom/fake) + pgvector + HNSW cosine index, batch, cost tracking         |                                                  |
| **API tài liệu**: upload → ingest → chunk → embed (tới `COMPLETED`) + `GET /documents/:id/{chunks,embeddings,jobs}` |                                                  |
| `GET /ai/providers`, `POST /ai/providers/test`                                                                      |                                                  |
| Docker Compose (app + postgres), Dockerfile multi-stage                                                             |                                                  |
| 157 test (136 unit + 21 e2e/integration)                                                                            |                                                  |

Chi tiết: [`docs/architecture/rag-architecture.md`](docs/architecture/rag-architecture.md),
[`docs/architecture/llm-providers.md`](docs/architecture/llm-providers.md),
[`docs/rag/document-parsing.md`](docs/rag/document-parsing.md),
[`docs/rag/data-cleaning.md`](docs/rag/data-cleaning.md),
[`docs/rag/chunking.md`](docs/rag/chunking.md),
[`docs/rag/embedding.md`](docs/rag/embedding.md).

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
├── common/{errors,types,utils,constants}/
└── health/
prisma/                # schema.prisma + migrations
docs/architecture/     # rag-architecture.md, llm-providers.md
docs/rag/              # document-parsing.md, data-cleaning.md, chunking.md, embedding.md
```
