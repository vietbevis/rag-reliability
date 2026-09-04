import { z } from 'zod';

/**
 * Hợp đồng biến môi trường của RAG Reliability Service.
 *
 * Mọi giá trị mà tiến trình phụ thuộc đều được khai báo ở đây và validate một
 * lần duy nhất lúc khởi động (xem {@link validateEnv}). Môi trường cấu hình sai
 * phải fail ngay lập tức và rõ ràng — không được để lỗi phát sinh muộn ở lần
 * gọi LLM đầu tiên.
 */

export const LlmProviderValues = [
  'openai',
  'gemini',
  'anthropic',
  'custom',
  'fake',
] as const;
// `fake`: embedding tất định (seed theo hash nội dung) — chỉ dùng cho CI/dev,
// KHÔNG có ý nghĩa ngữ nghĩa. Dùng để test toàn bộ pipeline mà không cần API key.
export const EmbeddingProviderValues = [
  'openai',
  'gemini',
  'custom',
  'fake',
] as const;

// Nhận diện "true"/"false"/"1"/"0" từ env và chuyển về boolean.
const boolish = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default(def);

// Chuỗi env -> number, có ràng buộc min/max/int và giá trị mặc định.
const numeric = (opts: {
  min?: number;
  max?: number;
  int?: boolean;
  default: number;
}) =>
  z
    .string()
    .trim()
    .refine((v) => v.length > 0 && !Number.isNaN(Number(v)), 'must be a number')
    .transform(Number)
    .pipe(
      (() => {
        let n = z.number();
        if (opts.int) n = n.int();
        if (opts.min !== undefined) n = n.min(opts.min);
        if (opts.max !== undefined) n = n.max(opts.max);
        return n;
      })(),
    )
    .default(opts.default);

export const envSchema = z
  .object({
    // ---- Runtime -----------------------------------------------------------
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: numeric({ int: true, min: 1, max: 65535, default: 3000 }),
    HOST: z.string().trim().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
      .default('log'),
    SWAGGER_ENABLED: boolish(true),

    // ---- Rate limiting (@nestjs/throttler) -------------------------------
    // Bảo vệ endpoint nặng (/rag/query gọi nhiều LLM) khỏi flood & cạn quota.
    RATE_LIMIT_ENABLED: boolish(true),
    RATE_LIMIT_TTL_MS: numeric({ int: true, min: 1000, default: 60_000 }),
    // Trần mặc định cho mọi route trong một cửa sổ TTL.
    RATE_LIMIT_LIMIT: numeric({ int: true, min: 1, default: 120 }),
    // Trần riêng, chặt hơn, cho các route RAG tốn kém (/rag/query, /rag/search).
    RATE_LIMIT_RAG_LIMIT: numeric({ int: true, min: 1, default: 20 }),
    // Trần riêng, chặt nhất, cho /agent/* (một run = nhiều vòng LLM + tool).
    RATE_LIMIT_AGENT_LIMIT: numeric({ int: true, min: 1, default: 10 }),

    // ---- Database --------------------------------------------------------
    DATABASE_URL: z
      .string()
      .trim()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
        'DATABASE_URL must be a PostgreSQL connection string',
      ),

    // ---- Lựa chọn provider ------------------------------------------------
    LLM_PROVIDER: z.enum(LlmProviderValues).default('openai'),
    EMBEDDING_PROVIDER: z.enum(EmbeddingProviderValues).default('openai'),

    // ---- OpenAI ---------------------------------------------------------
    OPENAI_API_KEY: z.string().trim().optional(),
    OPENAI_BASE_URL: z.string().trim().url().optional(),
    OPENAI_CHAT_MODEL: z.string().trim().default('gpt-4o'),
    OPENAI_EMBEDDING_MODEL: z.string().trim().default('text-embedding-3-small'),

    // ---- Google Gemini -------------------------------------------------
    GEMINI_API_KEY: z.string().trim().optional(),
    GEMINI_CHAT_MODEL: z.string().trim().default('gemini-2.5-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().trim().default('text-embedding-004'),

    // ---- Anthropic ----------------------------------------------------
    ANTHROPIC_API_KEY: z.string().trim().optional(),
    ANTHROPIC_CHAT_MODEL: z.string().trim().default('claude-sonnet-4-20250514'),

    // ---- Custom (API tương thích OpenAI) -----------------------------------
    CUSTOM_LLM_BASE_URL: z.string().trim().url().optional(),
    CUSTOM_LLM_API_KEY: z.string().trim().optional(),
    CUSTOM_LLM_MODEL: z.string().trim().optional(),
    CUSTOM_EMBEDDING_BASE_URL: z.string().trim().url().optional(),
    CUSTOM_EMBEDDING_API_KEY: z.string().trim().optional(),
    CUSTOM_EMBEDDING_MODEL: z.string().trim().optional(),

    // ---- Embedding ----------------------------------------------------
    EMBEDDING_DIMENSION: numeric({
      int: true,
      min: 1,
      max: 12288,
      default: 1024,
    }),
    // Tiền tố bất đối xứng cho các model họ E5 / GTE / BGE-M3
    // (intfloat/multilingual-e5-large yêu cầu "query: " và "passage: ").
    // Để trống → tự suy ra theo tên model (chứa "e5") nếu không đặt thủ công.
    EMBEDDING_QUERY_PREFIX: z.string().default(''),
    EMBEDDING_PASSAGE_PREFIX: z.string().default(''),
    EMBEDDING_BATCH_SIZE: numeric({
      int: true,
      min: 1,
      max: 2048,
      default: 96,
    }),
    // Metric khoảng cách cho pgvector (khớp với loại index HNSW đã tạo):
    // cosine (chuẩn cho embedding đã normalize) | l2 | ip
    EMBEDDING_DISTANCE: z.enum(['cosine', 'l2', 'ip']).default('cosine'),

    // ---- Parsing tài liệu (anydoc) ----------------------------------------
    FIRECRAWL_API_KEY: z.string().trim().optional(),
    FIRECRAWL_API_URL: z.string().trim().url().optional(),
    ANYDOC_OCR: z.enum(['reject', 'hosted']).default('reject'),

    // ---- Chunking (PHASE 2) ----------------------------------------------
    // structure = Markdown-aware (từ anydoc); fixed = cửa sổ token cố định (baseline);
    // semantic = cắt tại ranh giới ngữ nghĩa (khoảng cách embedding câu liền kề).
    CHUNKING_STRATEGY: z
      .enum(['structure', 'fixed', 'semantic'])
      .default('structure'),
    // semantic: phân vị (percentile) của khoảng cách embedding để coi là điểm cắt.
    // Cao hơn = ít điểm cắt = chunk to hơn.
    SEMANTIC_BREAKPOINT_PERCENTILE: numeric({
      int: true,
      min: 50,
      max: 99,
      default: 90,
    }),
    // semantic: số câu đệm mỗi bên khi tính embedding (giảm nhiễu câu đơn lẻ).
    SEMANTIC_BUFFER_SIZE: numeric({ int: true, min: 0, max: 5, default: 1 }),
    CHUNK_MAX_TOKENS: numeric({ int: true, min: 64, max: 4000, default: 512 }),
    CHUNK_MIN_TOKENS: numeric({ int: true, min: 1, max: 2000, default: 64 }),
    CHUNK_OVERLAP_TOKENS: numeric({
      int: true,
      min: 0,
      max: 1000,
      default: 64,
    }),

    // ---- Cấu hình RAG ------------------------------------------------
    QUALITY_THRESHOLD: numeric({ min: 0, max: 1, default: 0.7 }),
    RETRIEVAL_TOP_K: numeric({ int: true, min: 1, max: 200, default: 20 }),
    RERANK_TOP_K: numeric({ int: true, min: 1, max: 100, default: 5 }),
    // ---- Reranking (PHASE 7) --------------------------------------------
    // Bật/tắt bước rerank. Tắt → đi thẳng retrieval(topK=RERANK_TOP_K) → context.
    RERANK_ENABLED: boolish(false),
    // none = identity (baseline) | fake = heuristic token-overlap (CI) | llm = listwise LLM
    RERANK_PROVIDER: z.enum(['none', 'fake', 'llm']).default('none'),
    // Số ứng viên lấy từ retrieval để đưa vào reranker (rerank topN → topK).
    RERANK_CANDIDATES: numeric({ int: true, min: 1, max: 200, default: 20 }),
    MAX_CONTEXT_TOKENS: numeric({
      int: true,
      min: 256,
      max: 200000,
      default: 4000,
    }),
    // Ngưỡng điểm relevance của chunk tốt nhất để KHÔNG abstain (PROMPT §22).
    // Mặc định 0 ở baseline (chỉ abstain khi 0 chunk).
    RAG_MIN_RELEVANCE: numeric({ min: 0, max: 1, default: 0 }),
    RAG_MIN_CHUNKS: numeric({ int: true, min: 0, max: 50, default: 1 }),
    RAG_TEMPERATURE: numeric({ min: 0, max: 2, default: 0 }),
    // Retrieval bảng (P4): khi một mảnh của bảng bị cắt (`metadata.tableGroup`)
    // lọt vào context, kéo về các mảnh còn lại của bảng đó để LLM thấy đủ mọi
    // dòng (câu hỏi "liệt kê các mức / tỷ lệ" hay bị PARTIALLY_GROUNDED oan).
    RAG_TABLE_EXPANSION_ENABLED: boolish(true),
    RAG_TABLE_EXPANSION_MAX_CHUNKS: numeric({
      int: true,
      min: 0,
      max: 50,
      default: 8,
    }),

    // ---- Grounded generation + abstention (PHASE 8) --------------------
    // Master toggle. TẮT = hành vi baseline P4 (giữ hallucination đo được §35).
    // BẬT = ContextValidator siết ngưỡng + hậu kiểm answer↔context, hạ status
    // / sinh lại khi câu trả lời không bám ngữ cảnh.
    RAG_STRICT_GROUNDING: boolish(false),
    // Khi strict: abstain nếu điểm relevance cao nhất < ngưỡng này.
    RAG_ABSTAIN_MIN_RELEVANCE: numeric({ min: 0, max: 1, default: 0.15 }),
    // Khi strict: tỉ lệ token nội dung của answer xuất hiện trong context thấp
    // hơn ngưỡng → hạ status (GROUNDED→PARTIALLY) và/hoặc sinh lại.
    RAG_MIN_GROUNDING_RATIO: numeric({ min: 0, max: 1, default: 0.4 }),
    // Khi strict + câu trả lời đầu bị đánh dấu không bám ngữ cảnh: sinh lại 1 lần
    // với chỉ dẫn cứng hơn.
    RAG_REGENERATE_ON_UNGROUNDED: boolish(true),

    // ---- Citation cấp claim (PHASE 9) -----------------------------------
    // Bật/tắt tách claim + đối chiếu evidence + citation do backend quản lý.
    // TẮT = hành vi P4 (citations map thô theo usedContext, claims rỗng).
    RAG_CITATION_ENABLED: boolish(true),
    // Gộp tách claim vào chính lời gọi generation (bỏ 1 lời gọi LLM/truy vấn —
    // docs/audit/ARCHITECTURE_REVIEW.md §5.3). TẮT = luôn gọi ClaimExtractor riêng.
    RAG_CONSOLIDATE_CLAIMS: boolish(true),
    // Tỉ lệ token nội dung của claim phải xuất hiện trong chunk để coi là được
    // chunk đó hỗ trợ (claim-recall). Deterministic, không gọi LLM.
    CITATION_MIN_OVERLAP: numeric({ min: 0, max: 1, default: 0.5 }),
    // Số chunk evidence tối đa giữ cho mỗi claim.
    CITATION_MAX_PER_CLAIM: numeric({ int: true, min: 1, max: 10, default: 3 }),
    // Thử map claim quan hệ → cạnh RELATED trong Neo4j (chỉ khi GRAPH_RAG_ENABLED
    // và Neo4j sống; no-op nếu không). graph-rag.md §5.
    CITATION_RELATIONSHIP_ENABLED: boolish(true),
    // Số token nội dung tối thiểu của answer để chạy tách claim (answer ngắn hơn
    // coi như 1 claim = chính nó).
    CITATION_MIN_ANSWER_TOKENS: numeric({
      int: true,
      min: 1,
      max: 100,
      default: 6,
    }),

    // ---- Graph RAG (PHASE 5 — construction) ------------------------------
    // Công tắc tính năng. Khi bật: NEO4J_URI + NEO4J_PASSWORD bắt buộc, pipeline
    // ingest thêm bước GRAPHING (trích entity/quan hệ → Neo4j).
    GRAPH_RAG_ENABLED: boolish(false),
    NEO4J_URI: z.string().trim().optional(),
    NEO4J_USER: z.string().trim().default('neo4j'),
    NEO4J_PASSWORD: z.string().trim().optional(),
    NEO4J_MAX_POOL_SIZE: numeric({ int: true, min: 1, max: 500, default: 50 }),
    NEO4J_QUERY_TIMEOUT_MS: numeric({
      int: true,
      min: 1000,
      max: 120000,
      default: 15000,
    }),
    // Gộp chunk vào một lời gọi extraction tới trần token này.
    GRAPH_EXTRACT_MAX_TOKENS: numeric({
      int: true,
      min: 256,
      max: 32000,
      default: 3000,
    }),
    // Số vòng "gleaning" hỏi lại "còn sót entity/quan hệ nào không?" (tăng recall).
    GRAPH_EXTRACT_GLEANINGS: numeric({ int: true, min: 0, max: 5, default: 1 }),
    // Trần cứng số lời gọi LLM cho một tài liệu (chặn chi phí).
    GRAPH_EXTRACT_MAX_LLM_CALLS_PER_DOC: numeric({
      int: true,
      min: 1,
      max: 500,
      default: 40,
    }),
    // Danh sách loại thực thể (CSV) — giới hạn không gian output của extractor.
    GRAPH_ENTITY_TYPES: z
      .string()
      .trim()
      .default('PERSON,ORG,LOCATION,DATE,REGULATION,CONCEPT,EVENT,PRODUCT')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string()).min(1)),
    // Đổi prompt extraction ⇒ tăng số này ⇒ cache extraction cũ tự vô hiệu.
    GRAPH_PROMPT_VERSION: z.string().trim().default('1'),
    // Model riêng cho bước trích xuất graph. Để trống → dùng model LLM chính.
    // Dùng model KHÔNG-reasoning (vd qwen2.5:7b) — model "thinking" (qwen3) sinh
    // khối <think> rất dài trên structured-output ⇒ mỗi lời gọi vài phút.
    // Đổi model ⇒ khoá cache extraction đổi theo ⇒ chunk cũ sẽ trích lại.
    GRAPH_EXTRACT_MODEL: z.string().trim().optional(),

    // ---- Retrieval nâng cao (PHASE 6) -----------------------------------
    // Chiến lược mặc định khi client không chỉ định (POST /rag/query|search).
    RETRIEVAL_STRATEGY: z
      .enum(['vector', 'keyword', 'graph', 'hybrid'])
      .default('vector'),
    // Tinh chỉnh HNSW lúc query (pgvector, PHASE 16). 0 = giữ mặc định pgvector
    // (hnsw.ef_search = 40). Tăng → recall cao hơn, query chậm hơn (Supabase:
    // 100 ≈ acc@10 0.98; 250 ≈ 0.99). Áp bằng `SET LOCAL` trong 1 transaction.
    RETRIEVAL_HNSW_EF_SEARCH: numeric({
      int: true,
      min: 0,
      max: 1000,
      default: 0,
    }),
    // Chống "overfiltering": khi có filter metadata/documentId, filter áp SAU
    // index scan nên HNSW dễ trả thiếu kết quả. `hnsw.iterative_scan` quét thêm
    // cho đủ. GUC này CHỈ có ở pgvector >= 0.8 — chỉ bật khi chắc chắn phiên bản.
    RETRIEVAL_HNSW_ITERATIVE_SCAN: boolish(false),
    // Graph traversal (local) — graph-rag.md §4.
    GRAPH_MAX_HOPS: numeric({ int: true, min: 1, max: 4, default: 2 }),
    GRAPH_MAX_ENTITY_DEGREE: numeric({
      int: true,
      min: 10,
      max: 5000,
      default: 200,
    }),
    GRAPH_RETRIEVAL_TOP_K: numeric({
      int: true,
      min: 1,
      max: 100,
      default: 10,
    }),
    // Tầng 3 entity linking: rút thực thể từ query bằng LLM khi tầng 1/2 rỗng.
    GRAPH_LINK_USE_LLM: boolish(true),
    // Trọng số fusion (weighted) — chuẩn hoá nội bộ, chỉ tỉ lệ quan trọng.
    FUSION_WEIGHT_VECTOR: numeric({ min: 0, max: 10, default: 1.0 }),
    FUSION_WEIGHT_KEYWORD: numeric({ min: 0, max: 10, default: 0.7 }),
    FUSION_WEIGHT_GRAPH: numeric({ min: 0, max: 10, default: 0.8 }),
    // Hằng số k của Reciprocal Rank Fusion (RRF).
    FUSION_RRF_K: numeric({ int: true, min: 1, max: 200, default: 60 }),
    // 'rrf' (bền, không cần score cùng thang) | 'weighted' (dùng score chuẩn hoá).
    FUSION_METHOD: z.enum(['rrf', 'weighted']).default('rrf'),

    // ---- Ngưỡng độ tin cậy ------------------------------------------
    FAITHFULNESS_THRESHOLD: numeric({ min: 0, max: 1, default: 0.8 }),
    HALLUCINATION_THRESHOLD: numeric({ min: 0, max: 1, default: 0.1 }),

    // ---- Faithfulness & Contradiction (PHASE 10) ---------------------
    RAG_FAITHFULNESS_ENABLED: boolish(true),
    FAITHFULNESS_VERIFIER_MODE: z
      .enum(['auto', 'heuristic', 'llm'])
      .default('auto'),
    RAG_REGENERATE_ON_UNFAITHFUL: boolish(true),

    // ---- Agent tool-calling (PHASE 17) --------------------------------
    // Công tắc tính năng. TẮT (mặc định) = AgentModule không expose route nào,
    // phần RAG thuần không bị ảnh hưởng. Xem docs/architecture/agent-tools.md.
    AGENT_ENABLED: boolish(false),
    // Trần cứng chống vòng lặp bỏ chạy (PROMPT §52). Vượt bất kỳ trần nào →
    // agent nhảy thẳng bước finalize (tổng hợp từ evidence đã có / abstain).
    AGENT_MAX_STEPS: numeric({ int: true, min: 1, max: 50, default: 8 }),
    AGENT_MAX_TOOL_CALLS: numeric({ int: true, min: 1, max: 100, default: 12 }),
    AGENT_MAX_WALL_CLOCK_MS: numeric({
      int: true,
      min: 1000,
      max: 600000,
      default: 120000,
    }),
    AGENT_MAX_TOTAL_TOKENS: numeric({
      int: true,
      min: 1000,
      max: 2000000,
      default: 60000,
    }),
    AGENT_COST_BUDGET_USD: numeric({ min: 0, max: 100, default: 0.1 }),
    // Cắt kết quả tool trước khi đưa lại cho LLM (toàn văn vẫn lưu AgentStep).
    AGENT_TOOL_RESULT_MAX_TOKENS: numeric({
      int: true,
      min: 128,
      max: 32000,
      default: 2000,
    }),
    // Số lần gọi lặp cùng (toolName + input chuẩn hoá) trước khi loop-detector
    // chặn tool đó.
    AGENT_LOOP_REPEAT_THRESHOLD: numeric({
      int: true,
      min: 1,
      max: 10,
      default: 2,
    }),
    // Model riêng cho vòng agent. Để trống → dùng model LLM chính của provider.
    AGENT_MODEL: z.string().trim().optional(),
    // Ép model gọi tool ở LƯỢT ĐẦU (`tool_choice:'required'`) — chống model OSS
    // "lười" bỏ qua tool khi task rõ ràng cần (17.10 finding). Provider không
    // hỗ trợ ⇒ tự bỏ qua.
    AGENT_FORCE_FIRST_TOOL: boolish(true),
    // async = trả 202 + BullMQ worker (yêu cầu QUEUE_ENABLED); sync = chạy trong
    // request. Client vẫn có thể ghi đè từng request qua body `execution`.
    AGENT_EXECUTION: z.enum(['async', 'sync']).default('async'),
    // Số lỗi tool RETRYABLE liên tiếp trước khi agent dừng sớm → finalize.
    AGENT_TOOL_FAILURE_THRESHOLD: numeric({
      int: true,
      min: 1,
      max: 20,
      default: 4,
    }),

    // ---- Tool providers: MCP (Agent Reliability Platform) --------------
    // MCP = một Tool Provider, KHÔNG phải tool-type đặc biệt. Agent Core không
    // bao giờ biết. TẮT (mặc định) = chỉ LocalToolProvider. Xem
    // docs/architecture/target-state.md §4, §12.
    MCP_ENABLED: boolish(false),
    // JSON mảng cấu hình MCP server. Ví dụ:
    // [{"id":"actvn-mcp","transport":"streamable-http","url":"https://…",
    //   "headers":{"Authorization":"Bearer …"},"defaultRiskLevel":"medium"}]
    // Secrets nên inject qua ${ENV} ở tầng deploy, KHÔNG commit.
    MCP_SERVERS: z.string().trim().default('[]'),
    MCP_TOOL_TIMEOUT_MS: numeric({
      int: true,
      min: 1000,
      max: 120000,
      default: 30000,
    }),
    MCP_TOOL_MAX_RETRIES: numeric({ int: true, min: 0, max: 5, default: 1 }),

    // ---- Observability: Langfuse (PHASE 17.9) --------------------------
    // Bật ⇒ mỗi agent run được ghi thành 1 trace (span theo step) vào Langfuse
    // self-host. Best-effort: lỗi Langfuse KHÔNG làm hỏng run. Yêu cầu
    // LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY khi bật.
    LANGFUSE_ENABLED: boolish(false),
    LANGFUSE_HOST: z.string().trim().url().default('http://localhost:3030'),
    LANGFUSE_PUBLIC_KEY: z.string().trim().optional(),
    LANGFUSE_SECRET_KEY: z.string().trim().optional(),

    // ---- Queue xử lý tài liệu (PHASE 1 — BullMQ + Redis) ----------------
    // BẬT (mặc định): POST /documents trả 202 ngay, worker BullMQ chạy pipeline
    // ingest→chunk→embed→graph nền. TẮT: chạy inline đồng bộ trong request
    // (dùng cho test/CI/máy không có Redis).
    QUEUE_ENABLED: boolish(true),
    REDIS_HOST: z.string().trim().default('127.0.0.1'),
    REDIS_PORT: numeric({ int: true, min: 1, max: 65535, default: 6379 }),
    REDIS_PASSWORD: z.string().trim().optional(),
    REDIS_DB: numeric({ int: true, min: 0, max: 15, default: 0 }),
    // Số job document chạy song song trên worker. Giữ = 1 để không nghẽn LLM
    // local (Ollama phục vụ tuần tự).
    QUEUE_CONCURRENCY: numeric({ int: true, min: 1, max: 32, default: 1 }),
    // Số lần thử lại một job document khi lỗi (tổng số lần chạy = attempts).
    QUEUE_JOB_ATTEMPTS: numeric({ int: true, min: 1, max: 10, default: 3 }),
    // Trễ nền tảng cho backoff mũ giữa các lần thử lại job.
    QUEUE_JOB_BACKOFF_MS: numeric({
      int: true,
      min: 100,
      max: 600000,
      default: 5000,
    }),

    // ---- An toàn khi gọi AI API ---------------------------------------
    LLM_TIMEOUT_MS: numeric({
      int: true,
      min: 1000,
      max: 600000,
      default: 60000,
    }),
    LLM_MAX_RETRIES: numeric({ int: true, min: 0, max: 10, default: 3 }),
    LLM_RETRY_BASE_DELAY_MS: numeric({
      int: true,
      min: 50,
      max: 60000,
      default: 500,
    }),
  })
  .superRefine((env, ctx) => {
    // Provider đang được chọn bắt buộc phải có API key / base URL tương ứng.
    const requireKey = (cond: boolean, path: string, message: string): void => {
      if (cond) return;
      ctx.addIssue({ code: 'custom', path: [path], message });
    };

    if (env.CHUNK_MIN_TOKENS >= env.CHUNK_MAX_TOKENS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHUNK_MIN_TOKENS'],
        message: 'CHUNK_MIN_TOKENS phải nhỏ hơn CHUNK_MAX_TOKENS',
      });
    }
    if (env.CHUNK_OVERLAP_TOKENS >= env.CHUNK_MAX_TOKENS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHUNK_OVERLAP_TOKENS'],
        message: 'CHUNK_OVERLAP_TOKENS phải nhỏ hơn CHUNK_MAX_TOKENS',
      });
    }

    if (env.GRAPH_RAG_ENABLED) {
      requireKey(
        !!env.NEO4J_URI,
        'NEO4J_URI',
        'NEO4J_URI is required when GRAPH_RAG_ENABLED=true',
      );
      requireKey(
        !!env.NEO4J_PASSWORD,
        'NEO4J_PASSWORD',
        'NEO4J_PASSWORD is required when GRAPH_RAG_ENABLED=true (Neo4j luôn phải có mật khẩu)',
      );
    }

    if (env.LANGFUSE_ENABLED) {
      requireKey(
        !!env.LANGFUSE_PUBLIC_KEY && !!env.LANGFUSE_SECRET_KEY,
        'LANGFUSE_PUBLIC_KEY',
        'LANGFUSE_PUBLIC_KEY và LANGFUSE_SECRET_KEY bắt buộc khi LANGFUSE_ENABLED=true',
      );
    }

    // MCP_SERVERS luôn phải là JSON hợp lệ; nội dung bắt buộc chỉ khi bật.
    const mcp = tryParseMcpServers(env.MCP_SERVERS);
    if (!mcp.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_SERVERS'],
        message: mcp.error,
      });
    } else if (
      env.MCP_ENABLED &&
      mcp.value.filter((s) => s.enabled).length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_SERVERS'],
        message:
          'MCP_ENABLED=true nhưng MCP_SERVERS không có server nào enabled',
      });
    }

    switch (env.LLM_PROVIDER) {
      case 'openai':
        requireKey(
          !!env.OPENAI_API_KEY,
          'OPENAI_API_KEY',
          'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
        );
        break;
      case 'gemini':
        requireKey(
          !!env.GEMINI_API_KEY,
          'GEMINI_API_KEY',
          'GEMINI_API_KEY is required when LLM_PROVIDER=gemini',
        );
        break;
      case 'anthropic':
        requireKey(
          !!env.ANTHROPIC_API_KEY,
          'ANTHROPIC_API_KEY',
          'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
        );
        break;
      case 'custom':
        requireKey(
          !!env.CUSTOM_LLM_BASE_URL && !!env.CUSTOM_LLM_MODEL,
          'CUSTOM_LLM_BASE_URL',
          'CUSTOM_LLM_BASE_URL and CUSTOM_LLM_MODEL are required when LLM_PROVIDER=custom',
        );
        break;
    }

    switch (env.EMBEDDING_PROVIDER) {
      case 'openai':
        requireKey(
          !!env.OPENAI_API_KEY,
          'OPENAI_API_KEY',
          'OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai',
        );
        break;
      case 'gemini':
        requireKey(
          !!env.GEMINI_API_KEY,
          'GEMINI_API_KEY',
          'GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini',
        );
        break;
      case 'custom':
        requireKey(
          !!env.CUSTOM_EMBEDDING_BASE_URL && !!env.CUSTOM_EMBEDDING_MODEL,
          'CUSTOM_EMBEDDING_BASE_URL',
          'CUSTOM_EMBEDDING_BASE_URL and CUSTOM_EMBEDDING_MODEL are required when EMBEDDING_PROVIDER=custom',
        );
        break;
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Cấu hình một MCP server (target-state.md §12). MCP là một Tool Provider —
 * Agent Core không bao giờ thấy shape này.
 */
export const mcpServerConfigSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'id phải kebab-case ([a-z0-9-])'),
    transport: z.enum(['stdio', 'sse', 'streamable-http']),
    enabled: z.boolean().default(true),
    command: z.string().trim().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    defaultRiskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  })
  .superRefine((c, ctx) => {
    if (c.transport === 'stdio' && !c.command) {
      ctx.addIssue({
        code: 'custom',
        message: `server "${c.id}": stdio cần command`,
      });
    }
    if (c.transport !== 'stdio' && !c.url) {
      ctx.addIssue({
        code: 'custom',
        message: `server "${c.id}": ${c.transport} cần url`,
      });
    }
  });

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

function tryParseMcpServers(
  json: string,
): { ok: true; value: McpServerConfig[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'MCP_SERVERS không phải JSON hợp lệ' };
  }
  const parsed = z.array(mcpServerConfigSchema).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`)
        .join('; '),
    };
  }
  const ids = parsed.data.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'MCP_SERVERS có id trùng' };
  }
  return { ok: true, value: parsed.data };
}

/** Parse `MCP_SERVERS` đã validate (gọi sau `validateEnv`). */
export function parseMcpServers(json: string): McpServerConfig[] {
  const r = tryParseMcpServers(json);
  return r.ok ? r.value : [];
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate `process.env` theo {@link envSchema}. Được dùng làm hook `validate`
 * của `ConfigModule.forRoot`, nên Nest sẽ từ chối khởi động khi env sai.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  // Biến env khai báo rỗng (`KEY=`) coi như chưa đặt — nếu không, các trường
  // optional dạng URL sẽ fail vì chuỗi rỗng không phải URL hợp lệ.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.join('.') || '(root)';
      return `${path}: ${i.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return parsed.data;
}
