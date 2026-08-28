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
] as const;
export const EmbeddingProviderValues = ['openai', 'gemini', 'custom'] as const;

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
      default: 1536,
    }),
    EMBEDDING_BATCH_SIZE: numeric({
      int: true,
      min: 1,
      max: 2048,
      default: 96,
    }),

    // ---- Parsing tài liệu (anydoc) ----------------------------------------
    FIRECRAWL_API_KEY: z.string().trim().optional(),
    FIRECRAWL_API_URL: z.string().trim().url().optional(),
    ANYDOC_OCR: z.enum(['reject', 'hosted']).default('reject'),

    // ---- Chunking (PHASE 2) ----------------------------------------------
    // structure = Markdown-aware (từ anydoc); fixed = cửa sổ token cố định (baseline)
    CHUNKING_STRATEGY: z.enum(['structure', 'fixed']).default('structure'),
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
    MAX_CONTEXT_TOKENS: numeric({
      int: true,
      min: 256,
      max: 200000,
      default: 4000,
    }),

    // ---- Ngưỡng độ tin cậy ------------------------------------------
    FAITHFULNESS_THRESHOLD: numeric({ min: 0, max: 1, default: 0.8 }),
    HALLUCINATION_THRESHOLD: numeric({ min: 0, max: 1, default: 0.1 }),

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
