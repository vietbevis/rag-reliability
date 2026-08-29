# RAG Reliability Service

Hệ thống RAG **production-grade, độ tin cậy cao**. Mục tiêu duy nhất: LLM trả lời
**đúng khi có evidence** và **từ chối (`INSUFFICIENT_EVIDENCE`) khi không có** —
không đoán, không bịa, không tạo citation giả. Mọi tối ưu phải được chứng minh
bằng benchmark (baseline → experiment → regression).

> Đây **không** phải chatbot. Trọng tâm: Data Quality → Chunking → Embedding →
> Retrieval → Reranking → Grounding → Citation → Faithfulness → Hallucination
> Detection → Evaluation → Regression.

## Mục lục

1. [Kiến trúc & pipeline](#kiến-trúc--pipeline)
2. [Yêu cầu & cài đặt nhanh](#yêu-cầu--cài-đặt-nhanh)
3. [Cấu hình `.env`](#cấu-hình-env)
4. [Chạy Ollama local (LLM + embedding)](#chạy-ollama-local-llm--embedding)
5. [Ingest tài liệu](#ingest-tài-liệu)
6. [Truy vấn RAG](#truy-vấn-rag)
7. [Đánh giá & benchmark](#đánh-giá--benchmark)
8. [Kết quả benchmark thực đo](#kết-quả-benchmark-thực-đo)
9. [Vận hành production](#vận-hành-production)
10. [Lệnh tra cứu nhanh](#lệnh-tra-cứu-nhanh)
11. [Xử lý sự cố](#xử-lý-sự-cố)

---

## Kiến trúc & pipeline

**Stack:** NestJS 11 · TypeScript strict · PostgreSQL 16 + pgvector (HNSW cosine,
`vector(1024)`) · Prisma 7 (driver adapter `@prisma/adapter-pg`) · Neo4j 5 (graph
RAG, tuỳ chọn) · LangChain.js · `@firecrawl/anydoc` · `@nestjs/throttler` ·
Jest (ESM).

### Ingestion

```
Upload → PARSE (anydoc → plaintext → html) → NORMALIZE (NFKC, control char)
       → CLEAN (noise, markdown) → DEDUPLICATE (checksum + normalizedHash,
         thu hồi document mồ côi quá hạn) → QUALITY GATE (token ≥ 10, gibberish,
         score ≥ QUALITY_THRESHOLD) → CHUNK → EMBED (pgvector) → GRAPH (tuỳ chọn)
```

Trạng thái: `COMPLETED` · `CHUNKING` (chưa cấu hình embedding) · `REJECTED`
(trùng / kém chất lượng) · `FAILED` (parse lỗi / ingestion mồ côi được thu hồi).

### Query

```
query → retrieve (vector | keyword | graph | hybrid + RRF/weighted fusion)
      → rerank (tuỳ chọn: LLM listwise, fallback identity)
      → context build (token budget) → context validation (abstain gate)
      → generate (structured JSON + schema.parse server-side, kèm claims[])
      → evidence matching (lexical, thuần) → faithfulness verifier (heuristic
        + NLI LLM xác nhận) → citation build (backend cấp claimId, KHÔNG tin id LLM)
      → persist RagQuery + trace
```

`status`: `GROUNDED` / `PARTIALLY_GROUNDED` / `INSUFFICIENT_EVIDENCE` (abstain) /
`CONFLICTING_EVIDENCE` (context tự mâu thuẫn) / `ERROR` (lỗi hạ tầng — vẫn HTTP
200 kèm `error`, `RagQuery.error` được ghi để audit).

Tài liệu chi tiết: [`docs/architecture/`](docs/architecture/),
[`docs/rag/`](docs/rag/), [`docs/evaluation/`](docs/evaluation/). Đợt khắc phục
audit: [`docs/audit/REMEDIATION.md`](docs/audit/REMEDIATION.md).

---

## Yêu cầu & cài đặt nhanh

- **Node.js ≥ 24**
- **Docker + Docker Compose** (PostgreSQL + pgvector, Neo4j tuỳ chọn)
- **[Ollama](https://ollama.com)** cho LLM + embedding chạy local (hoặc API key
  OpenAI / Gemini / Anthropic)

```bash
git clone <repo> && cd rag-reliability
npm install
cp .env.example .env            # chỉnh theo mục "Cấu hình .env" bên dưới

# hạ tầng
docker compose up -d postgres   # PostgreSQL 16 + pgvector
ollama serve                    # nếu chưa chạy nền
ollama pull qwen2.5:7b                        # LLM
ollama pull zylonai/multilingual-e5-large     # embedding 1024d, đa ngôn ngữ

# schema
npm run prisma:generate
npm run prisma:deploy           # áp toàn bộ migration (gồm vector(1024) + FK index)

# chạy
npm run start:dev
```

- API: <http://localhost:3000>
- **Test console** (form UI cho mọi endpoint): <http://localhost:3000/console>
- Swagger: <http://localhost:3000/docs>
- Health: <http://localhost:3000/health> · Liveness: `/health/live`

### Toàn bộ trong Docker

```bash
cp .env.example .env
docker compose up -d --build    # app tự chạy `prisma migrate deploy` khi khởi động
curl localhost:3000/health
```

---

## Cấu hình `.env`

`.env` và `.env.example` có **cùng bộ 86 key**. Các nhóm quan trọng:

### Provider (đổi backend không sửa code)

```env
LLM_PROVIDER=custom          # custom (Ollama) | openai | gemini | anthropic | fake
EMBEDDING_PROVIDER=custom    # custom (Ollama) | openai | gemini | fake

CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
CUSTOM_LLM_API_KEY=ollama
CUSTOM_LLM_MODEL=qwen2.5:7b

CUSTOM_EMBEDDING_BASE_URL=http://localhost:11434/v1
CUSTOM_EMBEDDING_API_KEY=ollama
CUSTOM_EMBEDDING_MODEL=zylonai/multilingual-e5-large
```

> `fake` = provider tất định theo hash nội dung, **chỉ cho CI/test** (không cần
> mạng, không có ý nghĩa ngữ nghĩa).

### Embedding & vector dimension

```env
EMBEDDING_DIMENSION=1024      # PHẢI khớp cột vector trong DB — đổi cần migration mới
EMBEDDING_DISTANCE=cosine     # phải khớp opclass của HNSW index
EMBEDDING_QUERY_PREFIX=       # để trống → tự thêm "query: " khi tên model chứa "e5"
EMBEDDING_PASSAGE_PREFIX=     # để trống → tự thêm "passage: "
```

E5 / GTE / BGE-M3 dùng tiền tố bất đối xứng. `EmbeddingService` tự thêm
`"query: "` / `"passage: "` khi tên model chứa `e5`; nếu không, đặt tay 2 biến
trên.

### Chunking

```env
CHUNKING_STRATEGY=structure   # structure (Markdown-aware) | fixed | semantic
# semantic:
SEMANTIC_BREAKPOINT_PERCENTILE=90   # cao hơn = ít điểm cắt = chunk to hơn
SEMANTIC_BUFFER_SIZE=1              # số câu đệm mỗi bên khi tính embedding
CHUNK_MAX_TOKENS=512
CHUNK_MIN_TOKENS=64
```

### Rate limiting

```env
RATE_LIMIT_ENABLED=true       # false nếu deploy sau API gateway đã lo throttling
RATE_LIMIT_LIMIT=120          # trần mặc định / cửa sổ TTL
RATE_LIMIT_RAG_LIMIT=20       # trần riêng cho /rag/query & /rag/search
RATE_LIMIT_TTL_MS=60000
```

### Grounding / Citation / Faithfulness

```env
RAG_STRICT_GROUNDING=false    # true = siết ngưỡng relevance + hậu kiểm + regenerate
RAG_CITATION_ENABLED=true
RAG_CONSOLIDATE_CLAIMS=true   # gộp tách claim vào lời gọi generation (bỏ 1 LLM call)
RAG_FAITHFULNESS_ENABLED=true
FAITHFULNESS_VERIFIER_MODE=auto   # auto (heuristic + NLI xác nhận) | heuristic | llm
```

### Ingestion an toàn

```env
# INGESTION_STALE_AFTER_MS=900000   # document in-progress quá hạn này (15') được
                                    # thu hồi về FAILED để cho phép nạp lại
```

Toàn bộ biến + mô tả: [`.env.example`](.env.example).

---

## Chạy Ollama local (LLM + embedding)

```bash
# 1. Cài & khởi động Ollama (https://ollama.com/download)
ollama serve                                   # cổng mặc định 11434

# 2. Kéo model
ollama pull qwen2.5:7b                          # LLM sinh câu trả lời + NLI + judge
ollama pull zylonai/multilingual-e5-large       # embedding 1024d (tiếng Việt tốt)

# 3. Kiểm tra endpoint OpenAI-compatible
curl http://localhost:11434/v1/models
curl http://localhost:11434/v1/embeddings \
  -d '{"model":"zylonai/multilingual-e5-large","input":"query: thử"}' | jq '.data[0].embedding | length'
# → 1024

# 4. Xác nhận app thấy provider
curl -s -XPOST localhost:3000/ai/providers/test -H 'content-type: application/json' \
  -d '{"provider":"custom"}'
```

Model thay thế: LLM `qwen3:8b` / `llama3:8b`; embedding `bge-m3` (1024d, không
cần tiền tố) hoặc `nomic-embed-text` (768d — phải đổi `EMBEDDING_DIMENSION=768`
+ migration mới).

---

## Ingest tài liệu

```bash
# File (docx/pdf/xlsx/pptx/csv/html/md) — qua anydoc
curl -F "file=@quy-che-dao-tao.pdf" -F "title=Quy chế đào tạo" -F "source=phong-dt" \
  http://localhost:3000/documents

# Text trực tiếp
curl -H 'content-type: application/json' \
  -d '{"title":"Quy chế bảo lưu","source":"phong-dt","text":"# Quy chế...\n\n## Điều 1..."}' \
  http://localhost:3000/documents

# Theo dõi
curl localhost:3000/documents/<id>              # chi tiết + text đã clean
curl localhost:3000/documents/<id>/jobs         # từng stage + thời gian
curl localhost:3000/documents/<id>/chunks
curl localhost:3000/documents/<id>/embeddings

# Chạy lại
curl -XPOST localhost:3000/documents/<id>/ingest              # cả pipeline
curl -XPOST localhost:3000/documents/<id>/chunk -d '{"strategy":"semantic"}'
curl -XPOST localhost:3000/documents/<id>/embed
```

Giới hạn upload: **25 MB**/file. Định dạng không hỗ trợ → `400 UNSUPPORTED_MIME`.

---

## Truy vấn RAG

> Cách nhanh nhất để thử tất cả: mở **<http://localhost:3000/console>** — một
> trang form gọi thẳng mọi endpoint (health, ingest text/file, retrieval, RAG
> query, lịch sử, đánh giá, benchmark, graph). Cùng origin nên không vướng CORS;
> `GET /console` được `@SkipThrottle()`.

```bash
# Chỉ retrieval — kiểm tra "có kéo đúng chunk không", KHÔNG tốn LLM
curl -H 'content-type: application/json' -d '{
  "query": "Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?",
  "topK": 5,
  "strategy": "hybrid"
}' http://localhost:3000/rag/search

# Pipeline đầy đủ
curl -H 'content-type: application/json' -d '{
  "query": "Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?",
  "topK": 5,
  "strategy": "vector",
  "strict": true,
  "cite": true,
  "faithfulness": true
}' http://localhost:3000/rag/query
```

Body `POST /rag/query` (các cờ đều tuỳ chọn, mặc định lấy từ `.env`):

| Trường | Ý nghĩa |
|---|---|
| `query` | câu hỏi (bắt buộc) |
| `topK` | số chunk vào context |
| `strategy` | `vector` \| `keyword` \| `graph` \| `hybrid` |
| `rerank` | ghi đè `RERANK_ENABLED` |
| `strict` | ghi đè `RAG_STRICT_GROUNDING` |
| `cite` | ghi đè `RAG_CITATION_ENABLED` |
| `faithfulness` | ghi đè `RAG_FAITHFULNESS_ENABLED` |

Response: `{ id, status, answer, citations[], claims[], faithfulness, retrieval,
provider, model, usage, latencyMs, trace }`.

```bash
# Audit
curl localhost:3000/rag/queries                 # lịch sử (?status=GROUNDED&take=50)
curl localhost:3000/rag/queries/<id>            # chi tiết + citations
curl localhost:3000/rag/queries/<id>/trace      # timeline từng chặng
```

---

## Đánh giá & benchmark

Golden dataset: [`evaluation/datasets/*.jsonl`](evaluation/datasets/) — **111
case** / 5 file, mỗi case tự mang corpus (seed độc lập). Sinh lại từ thư viện
corpus + khai báo case:

```bash
npm run eval:datasets:gen     # → scripts/gen-eval-datasets.mjs
```

| File | Case | Loại |
|---|---:|---|
| `answerable.jsonl` | 57 | DIRECT_RETRIEVAL, SEMANTIC_QUERY, EXACT_IDENTIFIER |
| `multi-hop.jsonl` | 18 | MULTI_HOP (nối 2-3 tài liệu) |
| `unanswerable.jsonl` | 15 | ngoài phạm vi corpus (mục tiêu: abstain) |
| `adversarial.jsonl` | 15 | tiền đề sai / số bịa / điều kiện không tồn tại |
| `conflicting.jsonl` | 6 | hai văn bản mâu thuẫn |

```bash
# Chỉ retrieval metrics (nhanh, KHÔNG gọi LLM)
npm run evaluate:retrieval

# Đầy đủ (retrieval + generation + judge). --baseline để chốt mốc.
npm run evaluate -- --baseline
npm run evaluate                       # so với baseline, exit ≠ 0 nếu regression
npm run evaluate -- answerable multi-hop --label=exp-e5

# Benchmark before/after một biến thể (chạy dataset 2 lần)
curl -XPOST localhost:3000/evaluation/benchmark-rerank    -d '{"datasetName":"answerable"}'
curl -XPOST localhost:3000/evaluation/benchmark-grounding -d '{"datasetName":"answerable"}'
curl -XPOST localhost:3000/evaluation/benchmark-citation  -d '{"datasetName":"answerable"}'
curl -XPOST localhost:3000/evaluation/benchmark-strategies -d '{"datasetName":"answerable"}'

# Experiment chuẩn (exp-001..007) — xem docs/evaluation/experiments.md
curl -XPOST localhost:3000/evaluation/experiments/exp-003/run -d '{"datasetName":"answerable"}'
```

**Chỉ số** (định nghĩa: [`docs/evaluation/metrics.md`](docs/evaluation/metrics.md)):

- Retrieval: `recallAt5`, `precisionAt5`, `mrr`, `ndcgAt5`, `contextPrecision`,
  `contextRecall`.
- Generation: `abstentionAccuracy`, `answerCorrectness` (LLM judge),
  `citationAccuracy`, `faithfulness`, `claimLevelHallucinationRate`,
  `hallucinationRateProxy`.
- Thống kê: `passRate` + `passRateCI95Low/High` + `passRateMarginOfError`
  (bootstrap 95%, RNG có seed → tất định).

---

## Kết quả benchmark thực đo

Cấu hình: `LLM_PROVIDER=custom` → **Ollama `qwen2.5:7b`**; `EMBEDDING_PROVIDER=custom`
→ **Ollama `zylonai/multilingual-e5-large`** (1024d, tiền tố `query:` / `passage:`);
PostgreSQL 16 + pgvector HNSW cosine; chạy local (macOS, GPU); `.env` mặc định
(`RAG_STRICT_GROUNDING=false`, citation + faithfulness verifier bật). Ngày
2026-08-29. Lệnh: `npm run evaluate -- --baseline`.

### Tổng hợp 5 dataset (111 case)

| Dataset | N | passRate (95% CI) | Recall@5 | MRR | NDCG@5 | Ctx Precision | Ctx Recall | Abstention | Answer Correctness | Citation Acc | **Faithfulness** | Claim Halluc. | Halluc. proxy | Latency P50 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| **answerable** | 57 | 0.77 (0.67–0.88) | **0.991** | **1.00** | **0.984** | 0.982 | **1.00** | 1.00 | **0.877** | 0.668 | **0.983** | 0.018 | **0.00** | 17.8s |
| **multi-hop** | 18 | 0.44 (0.22–0.67) | 0.926 | 0.972 | 0.904 | 0.928 | 0.944 | 0.778 | 0.472 | 0.515 | 0.964 | 0.036 | 0.056 | 18.3s |
| **conflicting** | 6 | **1.00** | **1.00** | 0.833 | 0.871 | 0.806 | **1.00** | 1.00 | 0.667 | 0.689 | 0.833 | 0.167 | 0.00 | 31.8s |
| **adversarial** | 15 | 0.87 (0.67–1.0) | — | — | — | — | — | **0.867** | — | — | 0.750 | 0.25 | 0.133 | 6.6s |
| **unanswerable** | 15 | **1.00** | — | — | — | — | — | **1.00** | — | — | — | — | **0.00** | 10.3s |

`—` = không áp dụng (dataset abstain-target không có `expectedDocuments`).

### So với bản audit gốc (agy, N=18, "low statistical confidence")

| Chỉ số | Audit gốc | Sau khắc phục | Ghi chú |
|---|---|---|---|
| Faithfulness (answerable) | **0.00** | **0.983** | Bug P0-1 contradiction detector — đã sửa |
| Claim-level hallucination (answerable) | 0.667 | 0.018 | như trên |
| MRR (answerable) | 0.467 | **1.00** | e5-large + tiền tố query/passage (trước: OpenAI 1536d) |
| NDCG@5 (answerable) | 0.599 | **0.984** | như trên |
| Recall@5 (conflicting) | **0.00** | **1.00** | Dedup deadlock — đã sửa |
| Abstention (adversarial) | 0.75 (N=4) | 0.867 (N=15) | |
| Abstention (unanswerable) | 1.00 (N=4) | 1.00 (N=15) | |
| Hallucination proxy (answerable) | — | **0.00** | |

### Điểm yếu còn lại (giới hạn model, không phải bug)

- **multi-hop passRate 0.44**: retrieval tốt (Recall@5 0.93, Ctx Recall 0.94)
  nhưng `qwen2.5:7b` yếu suy luận 2-3 chặng — 4/18 case abstain dù đã có đủ ngữ
  cảnh (`MISSING_CONTEXT`), answer correctness 0.47. Model lớn hơn (`qwen3:8b`,
  API) cải thiện đáng kể.
- **citationAccuracy answerable 0.67**: câu trả lời **trung thực** (faithfulness
  0.98) nhưng LLM đôi khi trích chunk liên quan không phải tài liệu gold. 13/57
  case rớt pass-gate vì `citationAcc < 0.5` dù nội dung đúng — cân nhắc nới
  ngưỡng gate hoặc cải thiện prompt trích dẫn.
- **adversarial 2/15**: model trả lời tiền đề sai thay vì abstain hoàn toàn.

### Từng dataset chi tiết

```
answerable   57: 45 GROUNDED (34 pass) · 12 PARTIALLY_GROUNDED (10 pass)
                 13 rớt vì citation gate — câu trả lời vẫn faithful + đúng
multi-hop    18: 14 PARTIALLY_GROUNDED (8 pass) · 4 INSUFFICIENT_EVIDENCE (abstain sai)
conflicting   6: 5 PARTIALLY_GROUNDED + 1 GROUNDED — 6/6 pass, nêu đúng mâu thuẫn
adversarial  15: 13 abstain đúng · 2 trả lời tiền đề sai
unanswerable 15: 15/15 abstain đúng
```

Chạy lại: `npm run evaluate` (so với baseline vừa chốt, exit ≠ 0 nếu regression).

---

## Vận hành production

### Sau khi pull code mới

```bash
npm install                    # có thể có dependency mới (@nestjs/throttler)
npm run prisma:deploy          # áp migration
# nếu migration đụng cột Embedding (vd phase14 e5 1024d): bảng Embedding bị
# TRUNCATE → phải re-embed toàn bộ corpus:
#   for id in $(...); do curl -XPOST localhost:3000/documents/$id/embed; done
```

### Checklist production

- [ ] `RATE_LIMIT_ENABLED=true` (hoặc tắt nếu đã có gateway) — throttler `/rag/*`
      20 req/phút, còn lại 120.
- [ ] Đặt **auth** ở tầng gateway / reverse proxy (repo hiện chưa có guard).
- [ ] `NODE_ENV=production`, `SWAGGER_ENABLED=false`.
- [ ] `DATABASE_URL` trỏ Postgres có backup; chạy `prisma migrate deploy` trong
      release, không phải `migrate dev`.
- [ ] Ollama / provider LLM có giám sát; `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` hợp lý.
- [ ] Chạy `npm run evaluate -- --baseline` sau mỗi thay đổi corpus/model để có
      mốc regression; cắm `npm run evaluate` vào CI (exit ≠ 0 = chặn merge).
- [ ] Ingestion nặng: cân nhắc tách sang worker nền (BullMQ/Redis) — hiện còn
      đồng bộ trong HTTP request (giảm rủi ro bằng giới hạn 25 MB).

### Còn nợ (theo `docs/audit/REMEDIATION.md`)

- Async ingestion queue — chưa làm.
- API auth guard — quyết định để cho gateway.

---

## Lệnh tra cứu nhanh

| Lệnh | Việc |
|---|---|
| `npm run start:dev` | watch mode |
| `npm run build` | `nest build` |
| `npm run typecheck` | `tsc --noEmit` (strict, không `any`) |
| `npm run lint` | ESLint `--fix` |
| `npm test` | unit test (Jest ESM) |
| `npm run test:e2e` | e2e + integration (cần PostgreSQL chạy) |
| `npm run prisma:generate` | sinh Prisma Client vào `src/generated/prisma` |
| `npm run prisma:deploy` | `prisma migrate deploy` (production) |
| `npm run prisma:migrate` | `prisma migrate dev` (dev) |
| `npm run prisma:studio` | Prisma Studio |
| `npm run eval:datasets:gen` | sinh lại golden dataset JSONL |
| `npm run evaluate:retrieval` | retrieval metrics (nhanh) |
| `npm run evaluate` | eval đầy đủ + so baseline |
| `npm run docker:up` / `docker:down` | quản lý stack |

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân & xử lý |
|---|---|
| Khởi động cảnh báo `EMBEDDING_DIMENSION không khớp cột vector(N)` | Chạy `npm run prisma:deploy`. Nếu đổi model khác số chiều → cần migration mới đổi `vector(N)` + tạo lại HNSW. |
| `POST /documents` trả `REJECTED` "trùng lặp" cho file mới | Bản trùng trước đó kẹt ở EMBEDDING và **còn mới** (< 15'). Đợi hết `INGESTION_STALE_AFTER_MS` hoặc `POST /documents/:id/embed` trên bản cũ. Bản mồ côi quá hạn tự được thu hồi. |
| Keyword search trả 0 kết quả | Đã sửa: câu hỏi tự nhiên được `toKeywordQuery()` bỏ từ nghi vấn + nối `or`. Kiểm tra `GET /rag/search` với `strategy:"keyword"`. |
| `/rag/query` trả `429` | Chạm rate limit (`RATE_LIMIT_RAG_LIMIT=20`/phút). Tăng biến hoặc `RATE_LIMIT_ENABLED=false` cho dev. |
| `status: ERROR`, `error: "...LLM..."` | LLM/embedding provider down. Response vẫn 200. Kiểm tra `ollama ps`, `curl localhost:11434/v1/models`. |
| eval `⚠ corpus chưa sẵn sàng` | Provider embedding chưa cấu hình khi seed → doc dừng ở CHUNKING. Cấu hình `EMBEDDING_PROVIDER` rồi chạy lại. |
| e2e fail `vector dimension mismatch` | Test DB chưa migrate. `npm run prisma:deploy` lên DB test. |

---

## Cấu trúc thư mục

```
src/
├── config/            env.schema.ts (Zod) + configuration.ts (AppConfig có kiểu)
├── database/          PrismaService (Prisma 7 + adapter-pg)
├── ai/{llm,embeddings,reranking,tokenizer}/
├── common/
│   ├── rate-limit/    RateLimitModule (@nestjs/throttler, named throttler default+rag)
│   ├── utils/         text.util.ts (toKeywordQuery), hash, async
│   ├── errors/ observability/ types/ constants/
├── documents/         upload/CRUD + parsers/ (anydoc + plaintext/html fallback)
├── rag/
│   ├── ingestion/     normalize · clean · dedup (thu hồi mồ côi) · quality · orchestrator
│   ├── chunking/      structure | fixed | semantic · chunk quality · factory
│   ├── embedding/     chunk → pgvector (batch, advisory lock) · vector schema check
│   ├── retrieval/     vector · keyword (FTS) · graph (Neo4j) · fusion (RRF/weighted)
│   ├── context/       ContextBuilder (token budget) · ContextValidator (abstain gate)
│   ├── grounding/     answer-generation (structured + claims[]) · claim-extractor
│   │                  · evidence-matcher · contradiction-detector · faithfulness · citation
│   ├── graph/         entity/relation extraction → Neo4j
│   └── pipeline/      RagPipelineService
├── evaluation/
│   ├── datasets/      loader · seed · golden-datasets.spec.ts
│   ├── metrics/       retrieval · generation · statistics (bootstrapCI) · answer-judge
│   ├── experiments/   STANDARD_EXPERIMENTS (exp-001..007)
│   └── cli/           evaluate.js · experiment.js
└── health/
prisma/migrations/     8 migration (mới nhất: phase14_embedding_e5_1024)
evaluation/datasets/   golden dataset *.jsonl (111 case)
scripts/               gen-eval-datasets.mjs
docs/{architecture,rag,evaluation,audit}/
```
