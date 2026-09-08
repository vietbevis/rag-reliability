# Chuyển toàn bộ runtime sang Ollama local (PHASE 19)

**Ngày:** 2026-09-08
**Trạng thái:** đã duyệt (user: "bạn chạy giúp tôi đi")

## 1. Mục tiêu

Đưa mọi lời gọi LLM / embedding / reranking của RAG Reliability Service về
hạ tầng suy luận **local, $0/query, dữ liệu không rời máy**:

| Vai trò | Model | Cách phục vụ |
|---|---|---|
| LLM sinh câu trả lời RAG | `qwen3:8b` (bật thinking) | Ollama `/v1` — cổng 11434 |
| LLM structured / graph extract / agent loop | `qwen2.5:7b-instruct` (không thinking) | Ollama `/v1` — cổng 11434 |
| Embedding chính | `Qwen3-Embedding-0.6B` (1024d) | Ollama `/v1/embeddings` |
| Embedding thay thế (benchmark) | `bge-m3` (1024d) | Ollama `/v1/embeddings` — chỉ đổi env |
| Reranker | `Qwen3-Reranker-0.6B` | `llama-server --reranking` — cổng 11435, `/v1/rerank` |

Dimension giữ nguyên **1024** ⇒ KHÔNG cần migration đổi cột vector (khác đợt e5).

## 2. Quyết định thiết kế

### 2.1 Vì sao có process llama-server riêng cho reranker
- Ollama **không có** endpoint rerank.
- llama.cpp `llama-server` có `/v1/rerank` tương thích Jina; `--reranking` và
  `--embeddings` loại trừ nhau ⇒ phải là process riêng.
- API `/v1/rerank` (Jina shape) cũng là chuẩn của Infinity / TEI / vLLM ⇒ một
  provider HTTP duy nhất dùng được cho mọi backend về sau.
- Dùng GGUF chính chủ `ggml-org/Qwen3-Reranker-0.6B-Q8_0` (GGUF cộng đồng trả
  điểm hỏng ~4e-23 do thiếu tensor `cls.output.weight`).

### 2.2 Chiến lược "thinking" của qwen3:8b
- Ollama `/v1/chat/completions` **bỏ qua** `enable_thinking` / `chat_template_kwargs`
  (chỉ `/api/chat` native mới nhận `think:false`).
- ⇒ Điều khiển bằng: (a) chọn model, (b) chèn `/no_think` vào prompt.
- RAG answer generation: `qwen3:8b`, thinking mặc định BẬT (lợi cho suy luận đa
  bước trên context).
- Structured / graph / agent: `qwen2.5:7b-instruct` — vốn không có thinking,
  tool-calling tốt, nhanh. Giữ đúng pattern memory `[[llm-local-ollama]]`.
- `FAITHFULNESS_VERIFIER_MODE=heuristic` — chế độ `llm` chưa có model override,
  sẽ rơi vào qwen3:8b thinking ⇒ chậm. Heuristic đủ cho local.
- **Cải tiến code:** `CustomLlmProvider` chèn ` /no_think` vào message cuối khi
  `options.reasoning === false` VÀ tên model khớp `/qwen3/i`. Làm cho cờ
  `reasoning:false` (agent.node, entity-extractor) đúng kể cả khi ai đó trỏ
  chúng vào qwen3.

### 2.3 Tiền tố embedding
- `EmbeddingService` hiện tự thêm `query: `/`passage: ` khi tên model chứa `e5`.
- Thêm nhánh: tên model khớp `/qwen3.*embed/i` ⇒ query prefix mặc định
  `Instruct: Given a question, retrieve passages that answer it\nQuery: `,
  passage prefix rỗng (đúng khuyến nghị Qwen3-Embedding — chỉ query có instruct).
- `bge-m3` ⇒ không tiền tố (không khớp nhánh nào). Vẫn override được bằng
  `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_PASSAGE_PREFIX`.

### 2.4 Re-embed corpus
- Đổi tên model ⇒ mọi row `Embedding` cũ (model `zylonai/multilingual-e5-large`)
  thành mồ côi, làm bẩn HNSW index (trộn không gian vector 2 model).
- Migration `20260908xxxxxx_phase19_ollama_local_models`: `TRUNCATE "Embedding"`
  + đưa `Document` có chunk về `CHUNKING`. KHÔNG `ALTER` cột, KHÔNG rebuild index
  (dimension không đổi). Theo đúng khuôn e5 migration.
- Sau deploy: re-embed qua `POST /documents/:id/embed` hoặc chạy lại seed eval.

## 3. Thay đổi mã nguồn

### 3.1 Config
- `src/config/env.schema.ts`:
  - `RERANK_PROVIDER` enum thêm `'api'`.
  - Thêm `RERANK_BASE_URL` (url, optional), `RERANK_API_KEY` (optional),
    `RERANK_MODEL` (optional).
  - `validateEnv` cross-field: `RERANK_PROVIDER=api` ⇒ bắt buộc `RERANK_BASE_URL`
    + `RERANK_MODEL`.
- `src/config/configuration.ts`:
  - `AppConfig['rerank']`: thêm `baseUrl?`, `apiKey?`, `model?`; `provider` union
    thêm `'api'`.
  - map env tương ứng.

### 3.2 Reranker provider mới
- `src/ai/reranking/providers/api-reranker.provider.ts` — `ApiRerankerProvider`
  `implements RerankerProvider`, `name = 'api'`.
  - `isConfigured()` = có `baseUrl` + `model`.
  - `rerank(query, chunks, topK)`: POST `${baseUrl}/rerank` (hoặc `/v1/rerank`
    nếu baseUrl chưa có `/v1`), body Jina `{ model, query, documents: string[], top_n }`,
    header `Authorization: Bearer <apiKey>` nếu có.
  - Parse `results: [{ index, relevance_score }]` → map về `RerankedChunk`
    (`rerankScore`, `rank`), sort giảm dần, cắt `topK`.
  - Cắt mỗi document ~CHUNK_CLIP như `LlmRerankerProvider`.
  - Lỗi HTTP / timeout ⇒ ném (RerankerService tự fallback identity — §54).
  - `withTimeout` từ `common/` để không treo.
  - Nội dung chunk là **văn bản thô** — không nhúng vào prompt lệnh (§23), chỉ là
    phần tử `documents`, an toàn.
- `src/ai/reranking/reranker-factory.service.ts`:
  - `RerankProviderName` thêm `'api'`.
  - Inject `ApiRerankerProvider`, đăng ký `api` vào registry.
- `src/ai/ai.module.ts`: thêm `ApiRerankerProvider` vào `providers`.

### 3.3 LLM provider — /no_think cho qwen3
- `src/ai/llm/providers/base-langchain-llm.provider.ts`: thêm hook
  `protected prepareMessages(messages, options): ChatMessage[]` mặc định identity;
  `chat` / `chatStream` / `chatWithTools` / `chatStructured` gọi
  `toLangChainMessages(this.prepareMessages(messages, options))`.
- `src/ai/llm/providers/custom-llm.provider.ts`: override `prepareMessages` —
  khi `options.reasoning === false` và `resolveModelName` khớp `/qwen3/i`, thêm
  ` /no_think` vào cuối message cuối (giữ nguyên `enable_thinking:false` cho
  vLLM/SGLang).

### 3.4 Embedding
- `src/ai/embeddings/embedding.service.ts`: nhánh auto cho `/qwen3.*embed/i` như
  §2.3.

### 3.5 Migration
- `prisma/migrations/20260908xxxxxx_phase19_ollama_local_models/migration.sql`:
  `TRUNCATE "Embedding";` + `UPDATE "Document" SET status='CHUNKING' WHERE
  status IN ('COMPLETED','GRAPHING') AND EXISTS (chunk)`.

### 3.6 Env + docs
- `.env` và `.env.example`:
  - `CUSTOM_LLM_BASE_URL=http://localhost:11434/v1`, `CUSTOM_LLM_MODEL=qwen3:8b`,
    `CUSTOM_LLM_API_KEY=ollama`.
  - `CUSTOM_EMBEDDING_MODEL=Qwen3-Embedding-0.6B` (hoặc tên tag Ollama thực tế).
  - `GRAPH_EXTRACT_MODEL=qwen2.5:7b-instruct`, `AGENT_MODEL=qwen2.5:7b-instruct`.
  - `GRAPH_EXTRACT_MODEL` comment cập nhật.
  - `RERANK_ENABLED=true`, `RERANK_PROVIDER=api`,
    `RERANK_BASE_URL=http://localhost:11435/v1`, `RERANK_MODEL=Qwen3-Reranker-0.6B`,
    `RERANK_API_KEY=` (rỗng).
  - `FAITHFULNESS_VERIFIER_MODE=heuristic`.
- `docs/architecture/local-inference.md` (mới): 3 process, lệnh chạy, cách pull
  model, GGUF nào, cách kiểm tra `/v1/rerank`.
- `README.md` mục "Ollama local": cập nhật danh sách model + thêm bước reranker.

## 4. Test

- `api-reranker.provider.spec.ts` (mới, TDD trước): mock `fetch` —
  (1) map kết quả đúng thứ tự + cắt topK; (2) chunk rỗng ⇒ trả rỗng;
  (3) HTTP 500 ⇒ ném; (4) timeout ⇒ ném; (5) `isConfigured` theo config;
  (6) gắn `Authorization` khi có apiKey.
- `reranker-factory.service.spec.ts`: thêm case `provider='api'` → `ApiRerankerProvider`.
- `custom-llm.provider.spec.ts`: `reasoning:false` + model qwen3 ⇒ message cuối có
  `/no_think`; model không phải qwen3 ⇒ không đổi.
- `embedding.service.spec.ts`: model `Qwen3-Embedding-0.6B` ⇒ query có prefix
  `Instruct: …`, passage không; `bge-m3` ⇒ không prefix.
- `env.schema` test: `RERANK_PROVIDER=api` thiếu `RERANK_BASE_URL` ⇒ lỗi validate.
- Chạy full `npm test` + `npx eslint`.

## 5. Ngoài phạm vi

- Hybrid dense kép (BGE-M3 + Qwen3 cùng lúc) — chỉ wire env-switch, không chạy song song.
- Chuyển sang `@langchain/ollama` native (`/api/chat` + `think`) — giữ `custom` OpenAI-compat.
- Sparse / ColBERT của BGE-M3.
- Đổi `FAITHFULNESS` để nhận model override (ghi nhận là việc sau).
