# Kiến trúc RAG Reliability Service

> Tài liệu này mô tả kiến trúc tổng thể và triết lý thiết kế. Chi tiết từng
> thành phần (cleaning, chunking, retrieval, grounding, evaluation…) sẽ được
> bổ sung theo từng phase (xem `PROMPT.md §47`).

## 1. Triết lý

RAG **không** nhằm mục tiêu "LLM luôn trả lời". Mục tiêu là:

> LLM trả lời **đúng khi có evidence** và **biết từ chối khi không có evidence**.

Khi knowledge base không chứa thông tin, hệ thống phải trả về
`INSUFFICIENT_EVIDENCE` — không đoán, không bịa, không suy luận vượt evidence,
không tạo citation giả.

Mọi tối ưu phải được chứng minh bằng số liệu (baseline → experiment →
regression), không nói "cách này tốt hơn" mà phải "Recall@5 tăng X→Y,
Faithfulness tăng A→B, latency +C ms, cost +D%".

## 2. Trạng thái theo phase

> Lộ trình gốc = `PROMPT.md §47`. Đã chèn **Graph RAG** (entity graph + local
> traversal, lưu Neo4j) — dời P5-P12 xuống 1 bậc; graph retriever ghép vào
> phase retrieval. Xem `docs/architecture/graph-rag.md`.

| Phase | Nội dung                                                                                                    | Trạng thái    |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| 0     | Bootstrap: Nest · Prisma 7 · PostgreSQL · pgvector · Docker · config · health · multi-provider LLM · anydoc | ✅ Hoàn thành |
| 1     | Ingestion: parsing, normalize, cleaning, dedup, quality score, API upload/CRUD                              | ✅ Hoàn thành |
| 2     | Chunking: structure-aware (Markdown) + fixed (baseline) + chunk quality + API                               | ✅ Hoàn thành |
| 3     | Embedding đa provider (batch) + pgvector + HNSW index + API                                                 | ✅ Hoàn thành |
| 4     | Baseline RAG: vector retrieval → context → validate → generate + evaluation harness + golden dataset + baseline metrics | ✅ Hoàn thành |
| 5     | **Graph RAG — construction**: entity + relationship extraction (LLM + gleaning) → Neo4j; cache theo hash; ingestion stage `GRAPH`; cleanup/reconcile idempotent; API | ✅ Hoàn thành |
| 6     | Retrieval nâng cao: metadata filter · keyword · **graph traversal (local)** · hybrid · fusion               | ⏳            |
| 7     | Reranking + benchmark before/after                                                                          | ⏳            |
| 8     | Grounded generation + abstention                                                                            | ⏳            |
| 9     | Citation: claim → evidence → chunk/**entity/relationship** → document                                       | ⏳            |
| 10    | Faithfulness: claim extraction, evidence matching, contradiction                                            | ⏳            |
| 11    | Evaluation framework: golden dataset, metrics, experiments                                                  | ⏳            |
| 12    | Regression + observability                                                                                  | ⏳            |
| 13    | Benchmark đa provider + **vector vs graph vs hybrid** (quality / cost / latency)                            | ⏳            |

## 3. Cấu trúc module

```
src/
├── config/         # ConfigModule + validate env bằng Zod (env.schema.ts)
├── database/        # PrismaService (Prisma 7 + driver adapter @prisma/adapter-pg)
├── documents/       # upload/CRUD tài liệu + parsers (anydoc + fallback)
├── rag/ingestion/   # normalize · clean · dedup · quality · orchestrator
├── rag/chunking/    # structure-aware | fixed · chunk quality · factory
├── rag/embedding/   # orchestrator (chunk→pgvector) + kiểm tra vector schema
├── rag/retrieval/   # (P4) Retriever interface · VectorRetriever (pgvector) · RetrievalService orchestrator
├── rag/context/     # (P4) ContextBuilder (dedup·sort·token budget) · ContextValidator (abstain gate §22)
├── rag/grounding/   # (P4) AnswerGeneration (structured output + schema.parse §50); claim/faithfulness ở P8-10
├── rag/pipeline/    # (P4) RagPipelineService: retrieve→context→validate→generate→persist RagQuery
├── rag/graph/       # (P5) EntityExtractor (LLM+gleaning) · entity-resolution (thuần) · GraphWrite (UNWIND MERGE) · GraphCleanup (removeDoc/reconcile) · GraphExtractionCache · GraphIngestion (orchestrator) · GraphController (/graph/reconcile); graph traversal ở P6
├── graph/           # (P5) Neo4jService (driver pool, read/write/writeTx) · Neo4jSchemaService (constraint/index) · Neo4jHealthIndicator · graph.module (@Global)
├── evaluation/      # (P4) golden dataset loader · retrieval + generation metrics · EvaluationRun · CLI
├── ai/
│   ├── llm/         # LLMProvider interface + 5 provider (openai|gemini|anthropic|custom|fake)
│   ├── embeddings/  # EmbeddingProvider interface + 4 provider (openai|gemini|custom|fake)
│   ├── reranking/   # RerankerProvider interface (hiện thực ở PHASE 6)
│   └── tokenizer/   # đếm token (js-tiktoken)
├── documents/parsers/  # anydoc (chính) + plaintext/html (fallback)
├── common/         # errors, types (pipeline contracts §53), utils, constants
└── health/         # /health (db + pgvector), /health/live
```

## 4. Pipeline ingestion tài liệu (mục tiêu — hiện thực dần từ PHASE 1)

```mermaid
flowchart TD
  U[Upload file] --> M{Detect mimeType}
  M -->|anydoc ho tro| A[anydoc Parser]
  M -->|txt / md| P[PlainText Parser]
  M -->|html| H[HTML Parser]
  M -->|khong ho tro| RJ[REJECTED: UNSUPPORTED_MIME]
  A -->|loi native lib| P
  A --> MD[Markdown output]
  P --> TX[Text output]
  H --> TX
  MD --> NRM[Normalize]
  TX --> NRM
  NRM --> CLN["Clean: whitespace, unicode, OCR noise, header/footer"]
  CLN --> DED["Deduplicate: checksum + normalized-text hash"]
  DED --> Q{"Quality gate: score >= QUALITY_THRESHOLD?"}
  Q -->|khong| RJ2[REJECTED]
  Q -->|co| CHK["Structure-aware chunking: heading -> section -> paragraph -> token limit"]
  CHK --> CQ[Chunk quality score]
  CQ --> EMB["Embedding da provider (batch): openai|gemini|custom|fake"]
  EMB --> PG[("pgvector: vector(1536) + HNSW cosine")]
  PG --> GRF{"GRAPH_RAG_ENABLED?"}
  GRF -->|khong| DONE["Document COMPLETED"]
  GRF -->|co| GEX["(P5) GRAPHING: extract entity/quan he (cache theo hash) -> cleanup+write Neo4j"]
  GEX --> DONE
```

> Bước GRAPHING bọc try/catch (giống autoEmbed): Neo4j/extraction lỗi KHÔNG làm
> hỏng request — document + chunk + embedding vẫn hợp lệ, doc giữ ở `GRAPHING`,
> chạy lại qua `POST /documents/:id/graph`. Xem `docs/architecture/graph-rag.md`.

## 5. Pipeline truy vấn RAG (`POST /rag/query`)

Đường xanh (`PHASE 4` — đã hiện thực): vector search → context builder →
context validation → grounded generation → citation map thô → response.
Đường xám (P6-10): query analyzer, keyword search, fusion, reranker, claim
extraction, evidence matching, contradiction, faithfulness check.

```mermaid
flowchart TD
  QRY[Query] --> AN["(P6) Query analyzer: exact | semantic | filtered | multi-concept"]
  AN --> VEC["VECTOR SEARCH (P4)"]
  AN --> KW["(P6) Keyword search - full-text"]
  AN --> GR["(P6) Graph traversal (local)"]
  VEC --> FUS["(P6) Fusion: RRF / weighted"]
  KW --> FUS
  GR --> FUS
  FUS --> RR["(P7) Reranker: top 20 -> top 5 (co fallback)"]
  RR --> CB["CONTEXT BUILDER (P4): dedup, sort, token budget"]
  CB --> CV{"CONTEXT VALIDATION (P4): du evidence?"}
  CV -->|khong| ABS["INSUFFICIENT_EVIDENCE (khong goi LLM) — P4"]
  CV -->|co| GEN["GROUNDED GENERATION (P4): structured JSON + schema.parse"]
  GEN --> CE["(P8) Claim extraction"]
  CE --> EM["(P9) Evidence matching: claim -> chunk"]
  EM --> CD{"(P9) Contradiction?"}
  CD -->|co| CF["(P9) CONFLICTING_EVIDENCE: citation ca 2 nguon / abstain"]
  CD -->|khong| FF["(P10) Faithfulness check: supported / unsupported / contradicted"]
  FF --> CIT["CITATION MAP (P4 tho: usedContext -> chunk -> document; P9 cap claim)"]
  CIT --> RESP["Response: answer, status, citations, claims, retrieval, faithfulness, provider, model, usage"]
```

> PHASE 4 bỏ qua query analyzer / keyword / graph / fusion / reranker (đi thẳng
> `VEC → CB`) và trả `claims: []`, `faithfulness: null`. Xem `docs/rag/retrieval.md`
> và `docs/rag/grounding.md`.

## 6. Failure handling (PROMPT §54)

| Stage             | Khi lỗi                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser (anydoc)   | thử fallback parser → vẫn lỗi → `INGESTION_FAILED` với lý do cụ thể (`NEEDS_OCR`, `ENCRYPTED`, `MALFORMED`…)                                                   |
| Quality gate      | `REJECTED`                                                                                                                                                     |
| Embedding         | provider chưa cấu hình → bỏ qua (dừng `CHUNKING`); số chiều lệch → `INGESTION_PRECONDITION`; API lỗi → retry giới hạn rồi ném (giữ `EMBEDDING`, re-embed được) |
| Graph (P5)        | `GRAPH_RAG_ENABLED=false` → bỏ qua; Neo4j chết / extraction lỗi → ghi `IngestionJob(GRAPH, FAILED)`, giữ doc ở `GRAPHING` (chạy lại `POST /:id/graph`), request KHÔNG 500. Explicit endpoint ném lỗi rõ ràng. |
| Vector search     | lỗi hạ tầng (embed query fail) → HTTP 502 (`RetrievalService.error`), KHÔNG che thành `INSUFFICIENT_EVIDENCE`; fallback keyword ở P6                              |
| Reranker          | fallback ranking (giữ thứ tự fusion)                                                                                                                           |
| LLM               | phân loại lỗi (`RATE_LIMIT`, `OVERLOADED`, `SAFETY_BLOCK`…), retry lỗi tạm thời, (tương lai) fallback provider                                                 |
| Faithfulness fail | regenerate hoặc abstain                                                                                                                                        |

Không stage nào được che giấu lỗi.

## 7. Observability (PROMPT §38)

Mỗi truy vấn RAG sẽ trace: query analysis → vector/keyword retrieval → fusion →
reranking → context → generation → claims → evidence matching → faithfulness →
citations → response, kèm latency, token usage, estimated cost, retrieval
scores, số chunk, context tokens, model, provider, errors. Không log API key,
password, secrets. Tận dụng LangChain callbacks nơi phù hợp.

## 8. Cách benchmark (PROMPT §35–37, §59)

1. Chạy **baseline** (fixed chunking + vector search + prompt đơn giản), lưu
   metrics (Recall@5, MRR, NDCG, Faithfulness, Hallucination Rate…).
2. Mỗi cải tiến = một **experiment** với config / dataset version / metrics /
   latency / token / cost / provider + model được ghi lại.
3. **Regression**: `npm run evaluate` so sánh CURRENT vs BASELINE; nếu metric
   giảm quá ngưỡng (vd Recall -5%, Hallucination +3%) → FAIL CI.
