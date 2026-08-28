# ROLE

Bạn là Senior Backend Engineer + Senior RAG Engineer + Senior NestJS Architect.

Hãy xây dựng từ đầu một project **RAG Reliability Service** bằng:

* NestJS
* TypeScript
* PostgreSQL
* pgvector
* Prisma
* Redis nếu thực sự cần
* LangChain.js + LangGraph.js (cho orchestration, retrieval chain, agent workflow)
* Multi-provider LLM (OpenAI, Google Gemini, Anthropic, custom provider)
* @firecrawl/anydoc (document parsing)
* Docker Compose
* Jest

Project này là một project độc lập, mục tiêu duy nhất là xây dựng một hệ thống RAG production-grade có độ tin cậy cao.

KHÔNG xây chatbot business.
KHÔNG xây multi-agent phức tạp.
KHÔNG xây workflow engine tổng quát.

Tập trung hoàn thiện:

> Data Quality → Chunking → Embedding → Retrieval → Reranking → Grounding → Citation → Faithfulness → Hallucination Detection → Evaluation → Regression Benchmark.

---

# 1. MỤC TIÊU CUỐI CÙNG

Project phải có khả năng:

1. Upload/import documents
2. Parse documents (sử dụng anydoc + fallback parsers)
3. Clean dữ liệu
4. Normalize dữ liệu
5. Detect dữ liệu lỗi
6. Detect duplicate documents
7. Detect duplicate chunks
8. Quality scoring
9. Structure-aware chunking
10. Generate embeddings
11. Store embeddings bằng pgvector
12. Metadata filtering
13. Vector search
14. Keyword search
15. Hybrid search
16. Retrieval fusion
17. Reranking
18. Context building
19. Context validation
20. Grounded answer generation
21. Citation generation
22. Claim extraction
23. Claim-to-evidence matching
24. Faithfulness checking
25. Hallucination detection
26. Abstention khi không đủ evidence
27. Golden dataset
28. RAG evaluation
29. Retrieval metrics
30. Generation metrics
31. Regression benchmark
32. Observability
33. Token/cost tracking

---

# 2. TRIẾT LÝ QUAN TRỌNG NHẤT

RAG không có mục tiêu:

> "LLM luôn trả lời."

Mục tiêu là:

> "LLM trả lời đúng khi có evidence và biết từ chối khi không có evidence."

Nếu knowledge base không có thông tin:

Agent phải trả:

INSUFFICIENT_EVIDENCE

Không được:

* đoán
* bịa
* suy luận vượt quá evidence
* tạo citation giả

---

# 3. FRAMEWORK VÀ LIBRARY STRATEGY

## 3.1. LangChain.js + LangGraph.js

Sử dụng LangChain.js và LangGraph.js cho:

* RAG chain orchestration
* Retrieval chain composition
* Document loaders và text splitters (khi phù hợp)
* Output parsers / structured output
* Callback system cho observability
* LangGraph cho stateful RAG pipeline nếu cần

Tuy nhiên:

* Không dùng LangChain như một black box — phải hiểu mỗi component đang làm gì.
* Khi LangChain không có component phù hợp hoặc component quá generic → tự implement.
* Business logic quan trọng (grounding, faithfulness, claim extraction, citation mapping) nên được kiểm soát trực tiếp, có thể wrap trong LangChain custom components.
* Ưu tiên LangChain components cho: document loading, text splitting, vector store integration, retriever abstraction, chain composition.
* Ưu tiên custom implementation cho: data cleaning, quality scoring, deduplication, evidence matching, hallucination detection.

## 3.2. Library chuyên biệt

Có thể sử dụng thêm:

* @firecrawl/anydoc — document parsing
* Token counting libraries
* Similarity/hashing libraries
* Database drivers
* Các LLM SDK (OpenAI, Google GenAI, Anthropic)

## 3.3. Nguyên tắc chung

> Dùng framework khi nó tăng tốc development và không hy sinh khả năng kiểm soát.
> Tự implement khi business logic cần kiểm soát chặt hoặc framework không đáp ứng.
> Mọi component phải có interface rõ ràng để có thể swap implementation (LangChain ↔ custom).

---

# 4. MULTI-PROVIDER LLM ARCHITECTURE

## 4.1. Provider Abstraction

Thiết kế LLM layer với provider abstraction từ đầu:

```
src/ai/
├── ai.module.ts
├── llm/
│   ├── llm.interface.ts          // Core LLM interface
│   ├── llm-provider.enum.ts      // OPENAI | GEMINI | ANTHROPIC | CUSTOM
│   ├── llm-factory.service.ts    // Factory để tạo provider instance
│   ├── providers/
│   │   ├── openai-llm.provider.ts
│   │   ├── gemini-llm.provider.ts
│   │   ├── anthropic-llm.provider.ts
│   │   └── custom-llm.provider.ts
│   └── llm.service.ts            // Unified LLM service
├── embeddings/
│   ├── embedding.interface.ts
│   ├── embedding-factory.service.ts
│   ├── providers/
│   │   ├── openai-embedding.provider.ts
│   │   ├── gemini-embedding.provider.ts
│   │   └── custom-embedding.provider.ts
│   └── embedding.service.ts
└── reranking/
    ├── reranker.interface.ts
    └── providers/
        ├── llm-reranker.provider.ts
        └── custom-reranker.provider.ts
```

## 4.2. LLM Interface

```typescript
interface LLMProvider {
  readonly provider: LLMProviderEnum;
  
  chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;
  chatStream(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
  chatStructured<T>(messages: ChatMessage[], schema: ZodSchema<T>, options?: LLMOptions): Promise<T>;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  retryConfig?: RetryConfig;
  responseFormat?: 'text' | 'json';
}

interface LLMResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: LLMProviderEnum;
  latencyMs: number;
  finishReason: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}
```

## 4.3. Embedding Interface

```typescript
interface EmbeddingProvider {
  readonly provider: LLMProviderEnum;
  readonly dimensions: number;
  
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}

interface EmbeddingResult {
  vector: number[];
  usage: TokenUsage;
  model: string;
}
```

## 4.4. Provider Configuration

```env
# Active providers
LLM_PROVIDER=openai              # openai | gemini | anthropic | custom
EMBEDDING_PROVIDER=openai         # openai | gemini | custom

# OpenAI
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Google Gemini
GEMINI_API_KEY=
GEMINI_CHAT_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_CHAT_MODEL=claude-sonnet-4-20250514

# Custom provider (OpenAI-compatible API)
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=
CUSTOM_EMBEDDING_BASE_URL=
CUSTOM_EMBEDDING_API_KEY=
CUSTOM_EMBEDDING_MODEL=
```

## 4.5. Chuyển đổi Provider

Phải có khả năng chuyển provider bằng cách thay đổi environment variable.

Không được hard-code provider cụ thể vào business logic.

RAG pipeline, evaluation, và benchmark phải hoạt động giống nhau bất kể provider nào.

Khi benchmark/experiment: ghi rõ provider + model đã dùng.

## 4.6. LangChain Integration

Khi dùng LangChain.js, tận dụng `ChatOpenAI`, `ChatGoogleGenerativeAI`, `ChatAnthropic` từ LangChain.
Nhưng wrap chúng qua interface của chúng ta để:

* Thống nhất token/cost tracking
* Thống nhất error handling
* Thống nhất retry logic
* Dễ dàng swap mà không ảnh hưởng pipeline

---

# 5. DOCUMENT PARSING VỚI ANYDOC

## 5.1. Tổng quan

Sử dụng `@firecrawl/anydoc` làm primary document parser.

anydoc là Rust library (có Node.js binding) convert nhiều format sang clean Markdown:

* Word (.docx)
* PowerPoint (.pptx)
* Excel (.xlsx)
* OpenDocument (.odt, .odp, .ods)
* RTF
* EPUB
* CSV
* PDF (text-based)

## 5.2. Integration

```typescript
import { toMarkdown, toMarkdownBytes } from '@firecrawl/anydoc';

// Parse từ file path
const markdown = await toMarkdown('report.docx');

// Parse từ bytes (upload)
const markdown = await toMarkdownBytes(buffer);

// Parse với OCR cho scanned PDF
const markdown = await toMarkdown('scan.pdf', { ocr: 'hosted' });
```

## 5.3. Parser Architecture

```
src/documents/parsers/
├── parser.interface.ts
├── parser-factory.service.ts
├── anydoc-parser.service.ts        // Primary: @firecrawl/anydoc
├── plain-text-parser.service.ts    // Fallback: .txt, .md
└── html-parser.service.ts          // Fallback: .html
```

Flow:

```
Upload file
  ↓
Detect mimeType
  ↓
anydoc supported? → anydoc parser → Markdown output
  ↓ (no)
Fallback parser → text output
  ↓
Cleaning pipeline
```

## 5.4. Lưu ý

* anydoc output là Markdown → structure-aware chunking có thể tận dụng heading structure.
* PDF scanned cần OCR → configure `FIRECRAWL_API_KEY` nếu dùng hosted OCR.
* anydoc rất nhanh (single-digit milliseconds) → không cần async queue cho parsing đơn lẻ.
* Nếu anydoc fail → fallback về parser khác hoặc reject document với lý do rõ ràng.

---

# 6. PROJECT STRUCTURE

Tạo architecture gần với:

```
src/
├── app.module.ts
├── main.ts
│
├── config/
│   ├── config.module.ts
│   └── configuration.ts
│
├── database/
│   ├── database.module.ts
│   └── prisma.service.ts
│
├── ai/
│   ├── ai.module.ts
│   ├── llm/
│   │   ├── llm.interface.ts
│   │   ├── llm-provider.enum.ts
│   │   ├── llm-factory.service.ts
│   │   ├── llm.service.ts
│   │   └── providers/
│   │       ├── openai-llm.provider.ts
│   │       ├── gemini-llm.provider.ts
│   │       ├── anthropic-llm.provider.ts
│   │       └── custom-llm.provider.ts
│   ├── embeddings/
│   │   ├── embedding.interface.ts
│   │   ├── embedding-factory.service.ts
│   │   ├── embedding.service.ts
│   │   └── providers/
│   │       ├── openai-embedding.provider.ts
│   │       ├── gemini-embedding.provider.ts
│   │       └── custom-embedding.provider.ts
│   └── reranking/
│       ├── reranker.interface.ts
│       └── providers/
│
├── documents/
│   ├── documents.module.ts
│   ├── controllers/
│   ├── services/
│   ├── parsers/
│   │   ├── parser.interface.ts
│   │   ├── parser-factory.service.ts
│   │   ├── anydoc-parser.service.ts
│   │   ├── plain-text-parser.service.ts
│   │   └── html-parser.service.ts
│   └── dto/
│
├── rag/
│   ├── rag.module.ts
│   │
│   ├── ingestion/
│   │   ├── ingestion.service.ts
│   │   ├── document-cleaner.service.ts
│   │   ├── document-normalizer.service.ts
│   │   ├── document-deduplicator.service.ts
│   │   └── document-quality.service.ts
│   │
│   ├── chunking/
│   │   ├── chunking.interface.ts
│   │   ├── structure-aware-chunker.service.ts
│   │   └── chunk-quality.service.ts
│   │
│   ├── retrieval/
│   │   ├── retriever.interface.ts
│   │   ├── vector-retriever.service.ts
│   │   ├── keyword-retriever.service.ts
│   │   ├── hybrid-retriever.service.ts
│   │   ├── fusion.service.ts
│   │   └── reranker.service.ts
│   │
│   ├── context/
│   │   ├── context-builder.service.ts
│   │   └── context-validator.service.ts
│   │
│   ├── grounding/
│   │   ├── grounded-generation.service.ts
│   │   ├── claim-extractor.service.ts
│   │   ├── evidence-matcher.service.ts
│   │   ├── faithfulness.service.ts
│   │   ├── hallucination.service.ts
│   │   └── citation.service.ts
│   │
│   └── pipeline/
│       └── rag-pipeline.service.ts
│
├── evaluation/
│   ├── evaluation.module.ts
│   ├── datasets/
│   ├── evaluators/
│   │   ├── retrieval/
│   │   └── generation/
│   ├── metrics/
│   ├── benchmark.service.ts
│   └── regression.service.ts
│
├── health/
│
└── common/
    ├── errors/
    ├── types/
    ├── utils/
    └── constants/

test/
├── unit/
├── integration/
└── e2e/

evaluation/
├── datasets/
├── experiments/
└── reports/

docs/
├── architecture/
├── rag/
├── evaluation/
└── experiments/

docker/
docker-compose.yml
Dockerfile

prisma/
└── schema.prisma
```

Có thể thay đổi structure nếu có lý do kiến trúc rõ ràng.

---

# 7. DATABASE

Sử dụng:

PostgreSQL + pgvector + Prisma.

Thiết kế tối thiểu:

Document

DocumentChunk

Embedding

IngestionJob

RetrievalLog

RagQuery

Citation

EvaluationDataset

EvaluationCase

EvaluationRun

EvaluationResult

Có thể gộp hoặc tách bảng nếu có lý do.

---

# 8. DOCUMENT MODEL

Document phải có:

- id
- title
- source
- mimeType
- checksum
- version
- status
- rawText
- cleanedText
- parsedMarkdown (output từ anydoc)
- qualityScore
- metadata
- parserUsed (anydoc | plaintext | html | fallback)
- createdAt
- updatedAt

Status:

UPLOADED
PARSING
CLEANING
VALIDATING
CHUNKING
EMBEDDING
COMPLETED
FAILED
REJECTED

Không embedding document nếu quality validation fail.

---

# 9. DATA CLEANING

Implement pipeline:

Raw
 ↓
Parse (anydoc → Markdown)
 ↓
Normalize
 ↓
Clean
 ↓
Deduplicate
 ↓
Quality Check
 ↓
Clean Document

Cleaning phải xử lý:

- CRLF
- whitespace
- repeated whitespace
- Unicode normalization
- Vietnamese Unicode
- broken lines
- empty paragraphs
- repeated headers
- repeated footers
- page numbers
- OCR artifacts
- invisible characters
- malformed HTML
- Markdown noise (nếu anydoc output có artifacts)
- duplicated paragraphs

Không được silently sửa dữ liệu quan trọng.

Mỗi transformation quan trọng phải trace được.

---

# 10. DATA QUALITY SCORE

Tạo:

DocumentQualityService

Output:

{
  score: number,
  valid: boolean,
  issues: QualityIssue[]
}

QualityIssue:

{
  type,
  severity,
  message,
  location?
}

Ví dụ:

- EMPTY_DOCUMENT
- TOO_SHORT
- OCR_NOISE
- EXCESSIVE_SYMBOLS
- DUPLICATE_CONTENT
- BROKEN_ENCODING
- MISSING_METADATA

Có threshold configurable.

Ví dụ:

QUALITY_THRESHOLD=0.7

Nếu:

score < threshold

thì:

REJECT

---

# 11. DEDUPLICATION

Implement document-level deduplication bằng checksum/hash.

Sau đó chunk-level deduplication.

Phân biệt:

Exact duplicate

và

Near duplicate.

Không cần xây ML phức tạp cho near duplicate ở phase đầu.

Có thể sử dụng normalized text hash trước.

---

# 12. STRUCTURE-AWARE CHUNKING

Không chỉ dùng:

chunkSize = 500
overlap = 100

Ưu tiên:

Document
→ Heading
→ Section
→ Subsection
→ Paragraph

Vì anydoc output là Markdown, có thể tận dụng Markdown heading structure (#, ##, ###) để chunk theo semantic boundaries.

Sau đó mới áp dụng token limit.

Có thể sử dụng LangChain `MarkdownHeaderTextSplitter` hoặc `RecursiveCharacterTextSplitter` như baseline, rồi custom thêm logic nếu cần.

Chunk phải có:

- chunkId
- documentId
- content
- sequence
- tokenCount
- section
- page
- heading
- metadata

Chunk không được cắt giữa một semantic unit nếu có thể tránh.

---

# 13. CHUNK QUALITY

Mỗi chunk có quality check:

- quá ngắn?
- quá dài?
- thiếu context?
- bắt đầu giữa câu?
- kết thúc giữa câu?
- chứa quá nhiều noise?
- duplicate với chunk khác?

Không nhất thiết reject tất cả lỗi.

Phải có quality score.

---

# 14. EMBEDDING

Tạo interface:

EmbeddingService

Methods:

embed(text)

embedBatch(texts)

Không hard-code provider cụ thể vào RAG core.

Provider implementation nằm ở:

ai/embeddings/providers/

Embedding phải support batching.

Có retry.

Có timeout.

Có error handling.

Có token/cost tracking nếu API cung cấp usage.

Khi dùng LangChain, có thể wrap `OpenAIEmbeddings` / `GoogleGenerativeAIEmbeddings` qua interface của chúng ta.

---

# 15. PGVECTOR

Dùng pgvector để lưu embeddings.

Thiết kế index phù hợp.

Không tạo index mù quáng.

Document rõ:

- dimension
- distance metric
- index type
- trade-off

Lưu ý: dimension có thể khác nhau giữa các embedding provider:

- OpenAI text-embedding-3-small: 1536
- Gemini text-embedding-004: 768
- Custom: tùy model

Phải configurable qua EMBEDDING_DIMENSION.

Nếu PostgreSQL/pgvector không hỗ trợ một phần migration tự động qua Prisma:

sử dụng SQL migration có kiểm soát.

---

# 16. VECTOR RETRIEVAL

Implement:

VectorRetriever

Input:

{
  query,
  topK,
  filters?
}

Output:

RetrievedChunk[]

Mỗi result phải có:

{
  chunkId,
  documentId,
  content,
  score,
  metadata
}

Có thể dùng LangChain PgVector retriever hoặc custom implementation.

---

# 17. KEYWORD SEARCH

Implement keyword retrieval riêng.

Không dùng vector search cho mọi thứ.

Keyword search hữu ích với:

- mã văn bản
- ID
- số quyết định
- tên riêng
- technical terms
- exact phrase

PostgreSQL full-text search có thể được dùng.

---

# 18. HYBRID SEARCH

Implement:

Query
→ Vector Search
→ Keyword Search
→ Fusion
→ Reranking

Fusion phải configurable.

Ví dụ:

Weighted fusion

hoặc

Reciprocal Rank Fusion

Có interface để thay đổi strategy.

---

# 19. RERANKING

Retriever không được đưa toàn bộ kết quả cho LLM.

Ví dụ:

Vector + Keyword

Top 20

↓

Reranker

↓

Top 5

Reranker phải là abstraction:

RerankerService

Có thể bắt đầu với LLM-based reranking (dùng provider hiện tại), sau đó swap sang external API nếu cần.

Nếu dùng external reranking model/API:

- timeout
- retry
- cost tracking
- fallback

Nếu reranker fail:

hệ thống phải có fallback strategy.

---

# 20. QUERY UNDERSTANDING

Không cần LLM cho mọi query.

Phân loại:

- exact lookup
- semantic question
- filtered search
- multi-concept query

Query analyzer có thể quyết định retrieval strategy.

Không over-engineer.

---

# 21. CONTEXT BUILDER

Không đưa raw retrieval result thẳng vào prompt.

ContextBuilder phải:

- remove duplicate chunks
- sort theo relevance
- preserve source metadata
- enforce token budget
- avoid redundant information
- preserve enough context

Output:

GroundingContext

{
  chunks,
  totalTokens,
  sources
}

---

# 22. CONTEXT VALIDATION

Trước generation:

check:

- có context không?
- relevance score có đủ không?
- có conflicting documents không?
- source có hợp lệ không?
- context có quá dài không?

Nếu không đủ:

return:

INSUFFICIENT_EVIDENCE

Không gọi LLM generation trong trường hợp rõ ràng không có evidence.

---

# 23. GROUNDED GENERATION

LLM system instruction:

You answer questions using ONLY the supplied evidence.

Rules:

1. Do not invent facts.
2. Do not use external knowledge.
3. Do not guess.
4. Do not infer unsupported facts.
5. Every factual claim must be supported by evidence.
6. If evidence is insufficient, say so.
7. Never fabricate citations.

Output structured JSON:

{
  "answer": "...",
  "status": "GROUNDED",
  "claims": [],
  "citationIds": []
}

Status:

GROUNDED
PARTIALLY_GROUNDED
INSUFFICIENT_EVIDENCE

Validate output server-side.

Prompt template nên được quản lý tập trung, có thể dùng LangChain PromptTemplate.

---

# 24. CLAIM EXTRACTION

Sau generation:

Answer

↓

Claim Extraction

Mỗi claim:

{
  id,
  text
}

Ví dụ:

Answer:

"Trường cho phép bảo lưu tối đa 2 học kỳ và sinh viên phải gửi đơn trước 15 ngày."

Claims:

1.
"Trường cho phép bảo lưu tối đa 2 học kỳ."

2.
"Sinh viên phải gửi đơn trước 15 ngày."

---

# 25. EVIDENCE MATCHING

Mỗi claim phải được map tới evidence.

Ví dụ:

Claim:

"Được bảo lưu 2 học kỳ."

Evidence:

chunk_123

Output:

{
  claimId,
  supported: true,
  evidence: [
    "chunk_123"
  ]
}

Nếu không có evidence:

supported=false

---

# 26. CONTRADICTION DETECTION

Phải detect trường hợp:

Evidence A:

"Được bảo lưu 2 học kỳ."

Evidence B:

"Được bảo lưu 1 học kỳ."

Không được để LLM tự chọn một cách im lặng.

Output:

CONFLICTING_EVIDENCE

Khi conflict:

- report conflict
- citation cả hai nguồn
- hoặc abstain

Không tự quyết định nếu không có version/date/authority metadata rõ ràng.

---

# 27. FAITHFULNESS

Implement:

FaithfulnessService

Input:

answer
+
evidence

Output:

{
  score,
  grounded,
  claims
}

Mục tiêu:

Đánh giá answer có được support bởi evidence hay không.

Phải phân biệt:

- supported
- unsupported
- contradicted

---

# 28. HALLUCINATION DETECTION

Hallucination không chỉ là:

"LLM trả sai."

Phân loại root cause:

RETRIEVAL_FAILURE

BAD_SOURCE_DATA

MISSING_CONTEXT

IRRELEVANT_CONTEXT

CONFLICTING_CONTEXT

GENERATION_HALLUCINATION

CITATION_HALLUCINATION

Mỗi evaluation result phải cố gắng xác định failure layer.

---

# 29. CITATION

Citation phải được backend quản lý.

Không tin citation ID do LLM tự tạo.

Flow:

LLM claims

↓

Backend claim verification

↓

Map claim → chunk

↓

Map chunk → document/page

Output:

{
  claim,
  citation: {
    documentId,
    chunkId,
    page,
    section
  }
}

Nếu không map được:

citation không hợp lệ.

Không tạo citation giả.

---

# 30. ABSTENTION

Đây là feature bắt buộc.

Ví dụ:

Question:

"Trường có campus ở Singapore vào năm 2030 không?"

Nếu knowledge base không chứa:

Output:

{
  "status": "INSUFFICIENT_EVIDENCE",
  "answer": "Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi này.",
  "citations": []
}

Không được:

"Trường có thể sẽ..."

---

# 31. EVALUATION DATASET

Tạo:

evaluation/datasets/

Bao gồm:

answerable.jsonl

unanswerable.jsonl

adversarial.jsonl

multi-hop.jsonl

Mỗi case:

{
  "id": "case-001",
  "question": "...",
  "answerable": true,
  "expectedAnswer": "...",
  "expectedDocuments": [],
  "expectedChunks": []
}

---

# 32. TEST CASE TYPES

Phải có ít nhất:

## Type A — Direct Retrieval

Một chunk chứa câu trả lời.

## Type B — Multi-hop

Thông tin nằm ở nhiều chunks.

## Type C — Unanswerable

Knowledge base không có câu trả lời.

Expected:

ABSTAIN

## Type D — Adversarial

User cố ép model bịa.

## Type E — Conflicting Sources

Hai documents mâu thuẫn.

## Type F — Exact Identifier

Ví dụ:

"Quyết định 123/QĐ-HV"

## Type G — Semantic Query

Câu hỏi diễn đạt khác hoàn toàn source.

---

# 33. RETRIEVAL METRICS

Implement:

Recall@K

Precision@K

MRR

NDCG

Context Precision

Context Recall

Ví dụ:

npm run evaluate:retrieval

Output:

Recall@5
Precision@5
MRR
NDCG

---

# 34. GENERATION METRICS

Implement hoặc thiết kế evaluator cho:

Faithfulness

Answer Relevance

Answer Correctness

Citation Accuracy

Hallucination Rate

Abstention Accuracy

---

# 35. BASELINE

Đây là requirement cực kỳ quan trọng.

Trước khi tối ưu:

chạy baseline:

Fixed Chunking
+
Vector Search
+
Simple Prompt

Ghi lại metrics.

Ví dụ:

baseline:

Recall@5 = 0.72
MRR = 0.65
Faithfulness = 0.81
Hallucination Rate = 0.14

Sau đó mới tối ưu.

---

# 36. EXPERIMENTS

Mỗi cải tiến phải tạo experiment.

Ví dụ:

Experiment 001:

Fixed Chunking
vs
Structure-aware Chunking

Experiment 002:

Vector
vs
Hybrid

Experiment 003:

No reranker
vs
Reranker

Experiment 004:

Basic Prompt
vs
Grounded Prompt

Experiment 005:

No verifier
vs
Faithfulness Verifier

Experiment 006:

OpenAI gpt-4o
vs
Gemini 2.5 Flash
vs
Anthropic Claude Sonnet

Mỗi experiment ghi:

- configuration
- dataset version
- metrics
- latency
- token usage
- cost
- provider + model

---

# 37. REGRESSION

Nếu thay đổi:

- chunking
- embedding model
- retrieval
- reranker
- prompt
- LLM
- provider

phải có khả năng chạy:

npm run evaluate

và compare:

CURRENT
vs
BASELINE

Nếu metric giảm vượt threshold:

FAIL CI

Ví dụ:

Recall degradation > 5%

hoặc

Hallucination tăng > 3%

→ evaluation failure.

---

# 38. OBSERVABILITY

Mỗi RAG query phải trace:

query
→ query analysis
→ vector retrieval
→ keyword retrieval
→ fusion
→ reranking
→ context
→ generation
→ claims
→ evidence matching
→ faithfulness
→ citations
→ final response

Log:

- latency
- token usage
- estimated cost
- retrieval scores
- number of chunks
- context tokens
- model
- provider
- errors

Không log:

- API key
- password
- secrets

Có thể tận dụng LangChain Callbacks cho tracing.

---

# 39. API

Tạo các API:

POST /documents

GET /documents/:id

POST /documents/:id/ingest

GET /documents/:id/chunks

POST /rag/query

POST /rag/search

POST /evaluation/run

GET /evaluation/runs/:id

GET /health

GET /ai/providers (list available providers)

POST /ai/providers/test (test provider connectivity)

---

# 40. /rag/search

Endpoint này chỉ retrieval, KHÔNG gọi LLM.

Response:

{
  query,
  results: [
    {
      chunkId,
      documentId,
      score,
      content,
      metadata
    }
  ]
}

Mục đích:

debug retrieval độc lập với generation.

---

# 41. /rag/query

Flow:

Query

↓

Retrieve

↓

Rerank

↓

Context validation

↓

Generate

↓

Claim extraction

↓

Evidence matching

↓

Faithfulness

↓

Citation

↓

Final response

Response:

{
  answer,
  status,
  citations,
  claims,
  retrieval,
  faithfulness,
  provider,
  model
}

Có thể ẩn debug fields trong production nhưng giữ khả năng debug.

---

# 42. TESTING

Phải có:

Unit tests:

- cleaner
- normalizer
- quality checker
- chunker
- fusion
- context builder
- citation
- evidence matcher

Integration:

- PostgreSQL
- pgvector
- ingestion
- retrieval
- LLM provider switching

E2E:

POST /documents
→ ingest
→ POST /rag/query

Evaluation:

Golden dataset.

---

# 43. DOCKER

Tạo Docker Compose:

services:

postgres:
  PostgreSQL + pgvector

redis:
  optional

app:
  NestJS

Có healthcheck.

Không expose unnecessary ports.

---

# 44. ENVIRONMENT

Tạo:

.env.example

Bao gồm:

```env
# Database
DATABASE_URL=

# LLM Provider Selection
LLM_PROVIDER=openai
EMBEDDING_PROVIDER=openai

# OpenAI
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Google Gemini
GEMINI_API_KEY=
GEMINI_CHAT_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_CHAT_MODEL=claude-sonnet-4-20250514

# Custom Provider (OpenAI-compatible)
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=
CUSTOM_EMBEDDING_BASE_URL=
CUSTOM_EMBEDDING_API_KEY=
CUSTOM_EMBEDDING_MODEL=

# Embedding
EMBEDDING_DIMENSION=1536

# Document Parsing
FIRECRAWL_API_KEY=             # Optional: for anydoc OCR on scanned PDFs

# RAG Configuration
QUALITY_THRESHOLD=0.7
RETRIEVAL_TOP_K=20
RERANK_TOP_K=5
MAX_CONTEXT_TOKENS=4000

# Reliability
FAITHFULNESS_THRESHOLD=0.8
HALLUCINATION_THRESHOLD=0.1
```

Không commit .env.

---

# 45. DOCUMENTATION

Tạo:

docs/architecture/rag-architecture.md

docs/architecture/llm-providers.md

docs/rag/data-cleaning.md

docs/rag/document-parsing.md

docs/rag/chunking.md

docs/rag/retrieval.md

docs/rag/reranking.md

docs/rag/grounding.md

docs/rag/hallucination.md

docs/evaluation/metrics.md

docs/evaluation/experiments.md

docs/evaluation/regression.md

Mỗi tài liệu phải giải thích:

- vấn đề
- solution
- trade-off
- failure modes
- cách benchmark

---

# 46. MERMAID DIAGRAMS

Tạo diagram:

Document ingestion (bao gồm anydoc parsing)

Retrieval

RAG query

Grounding

Faithfulness

Evaluation

LLM Provider Architecture

Ví dụ:

Document:

Document
 ↓
anydoc Parser
 ↓
Markdown Output
 ↓
Cleaner
 ↓
Quality Gate
 ↓
Chunker (Markdown-aware)
 ↓
Embedding (multi-provider)
 ↓
pgvector

Query:

Query
 ↓
Analyzer
 ↓
┌───────────────┐
│ Vector Search │
│ Keyword Search│
└───────┬───────┘
        ↓
      Fusion
        ↓
     Reranker
        ↓
      Context
        ↓
   LLM (any provider)
        ↓
      Claims
        ↓
 Evidence Matching
        ↓
    Faithfulness
        ↓
     Citation
        ↓
     Response

---

# 47. DEVELOPMENT STRATEGY

Không implement tất cả cùng lúc.

Chia thành phases:

## PHASE 0

Project bootstrap.

- NestJS
- Prisma
- PostgreSQL
- pgvector
- Docker
- config
- health check
- Multi-provider LLM setup (interface + ít nhất 1 provider)
- anydoc integration setup

---

## PHASE 1

Document ingestion.

- anydoc parser integration
- fallback parsers
- cleaner
- normalizer
- quality score
- deduplication

---

## PHASE 2

Chunking.

- structure-aware chunking (Markdown-aware từ anydoc output)
- chunk quality
- metadata

---

## PHASE 3

Embedding + vector storage.

- Multi-provider embedding
- Batch processing

---

## PHASE 4

Baseline RAG.

Fixed chunking
+
Vector search
+
Simple generation

Chạy evaluation.

Lưu baseline metrics.

---

## PHASE 5

Improve retrieval.

- metadata filtering
- keyword search
- hybrid retrieval
- fusion

Benchmark.

---

## PHASE 6

Reranking.

Benchmark:

Before vs After.

---

## PHASE 7

Grounded generation.

- strict prompt
- structured output
- abstention

Benchmark hallucination.

---

## PHASE 8

Citation.

Claim → Evidence → Chunk → Document.

---

## PHASE 9

Faithfulness.

- claim extraction
- evidence matching
- contradiction detection
- verifier

---

## PHASE 10

Evaluation framework.

- golden dataset
- metrics
- experiments
- reports

---

## PHASE 11

Regression + observability.

---

## PHASE 12

Multi-provider benchmarking.

- So sánh quality/cost/latency giữa các provider
- Recommendation engine cho provider selection

---

# 48. IMPORTANT RULES

Trước khi code:

1. Inspect repository.
2. Xác nhận project hiện tại có thực sự empty/new.
3. Đề xuất architecture.
4. Tạo implementation plan.
5. Sau đó mới code.

Nếu project empty:

Không hỏi những câu hỏi không cần thiết.

Tự chọn reasonable defaults.

Nhưng nếu một quyết định ảnh hưởng architecture lớn:

hãy dừng và báo tôi.

---

# 49. KHÔNG OVER-ENGINEER

Không tạo:

- generic repository cho mọi entity
- 10 tầng abstraction
- factory của factory
- CQRS nếu không cần
- event sourcing
- microservices
- Kafka
- Kubernetes

Project này là một RAG production service.

Một NestJS monolith modular là đủ.

LangChain + LangGraph cung cấp đủ abstraction cho orchestration — không cần thêm layer.

---

# 50. CODE QUALITY

TypeScript strict.

Không dùng any nếu tránh được.

Không disable ESLint để code chạy.

Không suppress TypeScript errors.

Mọi external input phải validate.

Error handling phải rõ ràng.

Không để LLM output đi thẳng vào business logic mà không validate.

---

# 51. DATABASE MIGRATION

Không dùng:

prisma db push

cho production workflow.

Sử dụng:

prisma migrate dev

và migration SQL khi cần pgvector.

Mọi destructive migration phải báo trước.

---

# 52. AI API SAFETY

Mọi LLM/Embedding API calls (bất kể provider nào) phải có:

- timeout
- retry có giới hạn
- exponential backoff
- error classification
- token tracking
- cost estimation per provider

Không retry vô hạn.

Không để query làm phát sinh vô hạn LLM calls.

Provider-specific error handling:

- OpenAI: rate limit, token limit
- Gemini: quota, safety filters
- Anthropic: rate limit, overloaded
- Custom: generic HTTP errors

---

# 53. RAG PIPELINE CONTRACTS

Định nghĩa typed contracts rõ ràng:

RawDocument

CleanDocument

ParsedDocument (anydoc output)

DocumentChunk

EmbeddingVector

RetrievalQuery

RetrievedChunk

RerankedChunk

GroundingContext

GeneratedAnswer

Claim

Evidence

Citation

FaithfulnessResult

EvaluationResult

Không truyền object `any` giữa các pipeline stage.

---

# 54. FAILURE HANDLING

Mỗi stage phải có failure behavior.

Ví dụ:

Parser fail (anydoc)
→ try fallback parser
→ nếu vẫn fail → INGESTION_FAILED

Quality fail
→ REJECTED

Embedding fail
→ RETRY / FAILED

Vector search fail
→ fallback keyword nếu phù hợp

Reranker fail
→ fallback ranking

LLM fail
→ try fallback provider nếu configured
→ retry giới hạn

Faithfulness fail
→ regenerate hoặc abstain

Không che giấu failure.

---

# 55. PERFORMANCE

Không optimize sớm.

Nhưng phải đo:

- parsing latency (anydoc)
- ingestion latency
- embedding latency
- retrieval latency
- reranking latency
- generation latency
- total latency

Batch embedding.

Không gọi embedding API từng chunk nếu có thể batch.

---

# 56. COST

Theo dõi:

input tokens
output tokens
embedding tokens
estimated cost
provider
model

Mỗi RAG request có:

{
  usage: {
    inputTokens,
    outputTokens,
    embeddingTokens,
    estimatedCost,
    provider,
    model
  }
}

Cost estimation phải per-provider (pricing khác nhau giữa OpenAI, Gemini, Anthropic).

---

# 57. FINAL ACCEPTANCE CRITERIA

Project được coi là hoàn thành khi:

1. Có thể ingest document (qua anydoc).
2. Data được clean.
3. Data quality được đánh giá.
4. Document được chunk (Markdown-aware).
5. Chunk có metadata.
6. Embedding được lưu pgvector.
7. Có vector retrieval.
8. Có keyword retrieval.
9. Có hybrid retrieval.
10. Có reranking.
11. Có context validation.
12. Có grounded generation.
13. Có abstention.
14. Có citation.
15. Có claim verification.
16. Có faithfulness evaluation.
17. Có hallucination detection.
18. Có conflicting source handling.
19. Có golden dataset.
20. Có retrieval metrics.
21. Có generation metrics.
22. Có baseline.
23. Có experiment comparison.
24. Có regression test.
25. Có Docker.
26. Có unit/integration/e2e tests.
27. Có documentation.
28. Có observability.
29. Có token/cost tracking.
30. Có multi-provider LLM support (ít nhất 2 providers).
31. Có khả năng switch provider không cần code change.
32. Có provider comparison benchmark.

---

# 58. BẮT ĐẦU NGAY

Nếu repository đang empty:

BƯỚC 1:

Bootstrap NestJS project.

BƯỚC 2:

Setup:

- TypeScript strict
- ESLint
- Prettier
- Jest
- Prisma
- PostgreSQL
- pgvector
- Docker Compose
- ConfigModule
- LangChain.js + LangGraph.js
- @firecrawl/anydoc
- Multi-provider LLM interfaces

BƯỚC 3:

Tạo architecture.

BƯỚC 4:

Tạo:

docs/architecture/rag-architecture.md
docs/architecture/llm-providers.md

BƯỚC 5:

Tạo database schema.

BƯỚC 6:

Implement PHASE 0.

KHÔNG implement PHASE 1 ngay trong cùng task.

Sau khi PHASE 0 hoàn thành:

- run tests
- run lint
- run typecheck
- verify Docker
- verify database
- verify anydoc integration
- verify LLM provider connectivity
- review git diff

Sau đó báo cáo:

## PHASE 0 COMPLETE

### Implemented

...

### Architecture

...

### Files

...

### Providers

...

### Commands

...

### Tests

...

### Risks

...

### Next Phase

...

Dừng lại và chờ tôi yêu cầu phase tiếp theo.

---

# 59. QUAN TRỌNG NHẤT

Tôi không muốn một project:

"RAG demo chạy được."

Tôi muốn một project giúp tôi trả lời bằng số liệu:

- Chunking strategy nào tốt hơn?
- Retrieval strategy nào tốt hơn?
- Hybrid search cải thiện bao nhiêu?
- Reranking cải thiện bao nhiêu?
- Data cleaning ảnh hưởng Recall như thế nào?
- Grounded prompting giảm hallucination bao nhiêu?
- Faithfulness verifier bắt được bao nhiêu hallucination?
- Khi nào hệ thống nên abstain?
- Khi nào retrieval thất bại?
- Khi nào LLM hallucinate dù retrieval đúng?
- Cost/latency của từng strategy là bao nhiêu?
- Provider nào cho quality/cost ratio tốt nhất?
- Switching provider ảnh hưởng metrics như thế nào?

Mọi optimization phải có benchmark chứng minh.

Đừng nói:

"cách này tốt hơn."

Hãy chứng minh:

"Recall@5 tăng từ X → Y, Faithfulness tăng từ A → B, nhưng latency tăng C ms và cost tăng D%. Tested with provider Z, model W."

Đó là tiêu chuẩn của project.
