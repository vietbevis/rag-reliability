# Hạ tầng suy luận local (PHASE 19)

Toàn bộ LLM / embedding / reranking chạy local — $0/query, dữ liệu không rời máy.

## Ba process

```
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│ Ollama  (ollama serve)      │     │ llama-server  (rerank riêng)      │
│ cổng 11434  /v1             │     │ cổng 11435  /v1/rerank           │
│                             │     │                                  │
│  qwen3:8b          chat RAG  │     │  Qwen3-Reranker-0.6B             │
│  qwen2.5:7b-instruct         │     │  --reranking --pooling rank      │
│      structured/graph/agent  │     └──────────────────────────────────┘
│  dengcao/Qwen3-Embedding-0.6B│              ▲
│      embedding (1024d)       │              │ RERANK_PROVIDER=api
│  bge-m3   embedding thay thế │              │ RERANK_BASE_URL=…:11435/v1
└─────────────────────────────┘              │
        ▲                                    │
        │ CUSTOM_LLM_BASE_URL / CUSTOM_EMBEDDING_BASE_URL
        │
┌───────┴──────────────────────────────────────────┐
│ RAG Reliability Service (NestJS, cổng 3000)       │
│  LlmService · EmbeddingService · RerankerService  │
└──────────────────────────────────────────────────┘
```

Ollama **không có** endpoint rerank và `llama-server` thì `--reranking` loại trừ
`--embeddings` — nên reranker phải là process thứ hai. API `/v1/rerank` của
llama-server tương thích Jina, giống Infinity / text-embeddings-inference / vLLM,
nên `ApiRerankerProvider` phủ mọi backend đó.

## Khởi động

```bash
# 1. Ollama
ollama serve
ollama pull qwen3:8b
ollama pull qwen2.5:7b-instruct
ollama pull dengcao/Qwen3-Embedding-0.6B:Q8_0     # kiểm tra tên thật bằng `ollama list`
ollama pull bge-m3

# 2. Reranker — GGUF CHÍNH CHỦ (GGUF cộng đồng thiếu tensor cls.output.weight
#    ⇒ điểm ~4e-23). Cần llama.cpp mới (build có /v1/rerank).
llama-server -hf ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF \
  --reranking --pooling rank --port 11435

# 3. Service
npm run start:dev
```

## Kiểm tra

```bash
curl http://localhost:11434/v1/models
curl http://localhost:11435/v1/rerank -H 'content-type: application/json' -d '{
  "model":"Qwen3-Reranker-0.6B",
  "query":"thủ tục đăng ký học lại",
  "documents":["Sinh viên đăng ký học lại tại phòng đào tạo.","Lịch thi học kỳ 2."]
}'
# → results[0].index = 0 với relevance_score cao hơn

curl -sXPOST localhost:3000/ai/providers/test -H 'content-type: application/json' \
  -d '{"provider":"custom"}'
```

## Quyết định thiết kế

### Thinking của qwen3:8b
Ollama `/v1/chat/completions` **bỏ qua** `enable_thinking` / `chat_template_kwargs`
(chỉ `/api/chat` native nhận `think:false`). Vì vậy:

- **RAG answer** — `qwen3:8b`, thinking mặc định BẬT (lợi cho suy luận nhiều bước
  trên context).
- **structured / graph extract / agent** — `qwen2.5:7b-instruct`: không có
  thinking, tool-calling tốt, nhanh. `GRAPH_EXTRACT_MODEL` + `AGENT_MODEL` trỏ
  vào đây.
- `CustomLlmProvider.prepareMessages` chèn ` /no_think` vào message cuối khi
  `options.reasoning === false` **và** tên model khớp `/qwen3/i` — để cờ
  `reasoning:false` (agent.node, entity-extractor) vẫn đúng nếu ai đó trỏ chúng
  vào qwen3.
- `FAITHFULNESS_VERIFIER_MODE=heuristic` — chế độ `auto`/`llm` gọi qwen3:8b
  (thinking) cho từng claim ⇒ quá chậm; bật lại khi có model NLI riêng.

### Tiền tố embedding
`EmbeddingService` tự suy ra theo tên model:

| Model khớp | query prefix | passage prefix |
|---|---|---|
| `/e5/i` | `query: ` | `passage: ` |
| `/qwen3.*embed/i` | `Instruct: Given a question, retrieve passages that answer it\nQuery: ` | *(không)* |
| `bge-m3`, khác | *(không)* | *(không)* |

Override bằng `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_PASSAGE_PREFIX`.

### Đổi embedding model ⇒ re-embed
`Qwen3-Embedding-0.6B` và `bge-m3` đều 1024d ⇒ **không** migration đổi cột vector.
Nhưng `@@unique([chunkId, model])` ⇒ vector cũ mồ côi + trộn hai không gian vector
trong cùng HNSW index. Migration `20260908120000_phase19_reembed_ollama_models`
`TRUNCATE "Embedding"` + đưa Document về `CHUNKING`; sau đó re-embed qua
`POST /documents/:id/embed` hoặc chạy lại seed eval.

## Đổi sang bge-m3
Chỉ đổi `CUSTOM_EMBEDDING_MODEL=bge-m3` rồi re-embed toàn bộ corpus (khoá
`model` trong bảng `Embedding` đổi). Không cần migration.
