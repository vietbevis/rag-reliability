import { validateEnv, type Env } from './env.schema';

/**
 * Góc nhìn có kiểu, phân theo nhóm, của biến môi trường. Được truy cập qua
 * `ConfigService<AppConfig, true>` để các nơi gọi không bao giờ động thẳng vào
 * `process.env` và không bao giờ nhận giá trị không có kiểu.
 */
export interface AppConfig {
  app: {
    nodeEnv: Env['NODE_ENV'];
    port: number;
    host: string;
    logLevel: Env['LOG_LEVEL'];
    swaggerEnabled: boolean;
    isProduction: boolean;
  };
  database: {
    url: string;
  };
  llm: {
    provider: Env['LLM_PROVIDER'];
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    openai: { apiKey?: string; baseUrl?: string; chatModel: string };
    gemini: { apiKey?: string; chatModel: string };
    anthropic: { apiKey?: string; chatModel: string };
    custom: { baseUrl?: string; apiKey?: string; model?: string };
  };
  embedding: {
    provider: Env['EMBEDDING_PROVIDER'];
    dimension: number;
    batchSize: number;
    distance: Env['EMBEDDING_DISTANCE'];
    openai: { apiKey?: string; baseUrl?: string; model: string };
    gemini: { apiKey?: string; model: string };
    custom: { baseUrl?: string; apiKey?: string; model?: string };
  };
  parsing: {
    firecrawlApiKey?: string;
    firecrawlApiUrl?: string;
    ocr: Env['ANYDOC_OCR'];
  };
  chunking: {
    strategy: Env['CHUNKING_STRATEGY'];
    maxTokens: number;
    minTokens: number;
    overlapTokens: number;
  };
  rag: {
    qualityThreshold: number;
    retrievalTopK: number;
    rerankTopK: number;
    maxContextTokens: number;
  };
  reliability: {
    faithfulnessThreshold: number;
    hallucinationThreshold: number;
  };
}

/**
 * Hook `load` cho `ConfigModule.forRoot`. Validate đã chạy ở hook `validate`;
 * hàm này chỉ tái cấu trúc env phẳng thành {@link AppConfig}.
 */
export function loadConfiguration(): AppConfig {
  const env: Env = validateEnv(process.env);

  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
      logLevel: env.LOG_LEVEL,
      swaggerEnabled: env.SWAGGER_ENABLED,
      isProduction: env.NODE_ENV === 'production',
    },
    database: {
      url: env.DATABASE_URL,
    },
    llm: {
      provider: env.LLM_PROVIDER,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxRetries: env.LLM_MAX_RETRIES,
      retryBaseDelayMs: env.LLM_RETRY_BASE_DELAY_MS,
      openai: {
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        chatModel: env.OPENAI_CHAT_MODEL,
      },
      gemini: { apiKey: env.GEMINI_API_KEY, chatModel: env.GEMINI_CHAT_MODEL },
      anthropic: {
        apiKey: env.ANTHROPIC_API_KEY,
        chatModel: env.ANTHROPIC_CHAT_MODEL,
      },
      custom: {
        baseUrl: env.CUSTOM_LLM_BASE_URL,
        apiKey: env.CUSTOM_LLM_API_KEY,
        model: env.CUSTOM_LLM_MODEL,
      },
    },
    embedding: {
      provider: env.EMBEDDING_PROVIDER,
      dimension: env.EMBEDDING_DIMENSION,
      batchSize: env.EMBEDDING_BATCH_SIZE,
      distance: env.EMBEDDING_DISTANCE,
      openai: {
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_EMBEDDING_MODEL,
      },
      gemini: {
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_EMBEDDING_MODEL,
      },
      custom: {
        baseUrl: env.CUSTOM_EMBEDDING_BASE_URL,
        apiKey: env.CUSTOM_EMBEDDING_API_KEY,
        model: env.CUSTOM_EMBEDDING_MODEL,
      },
    },
    parsing: {
      firecrawlApiKey: env.FIRECRAWL_API_KEY,
      firecrawlApiUrl: env.FIRECRAWL_API_URL,
      ocr: env.ANYDOC_OCR,
    },
    chunking: {
      strategy: env.CHUNKING_STRATEGY,
      maxTokens: env.CHUNK_MAX_TOKENS,
      minTokens: env.CHUNK_MIN_TOKENS,
      overlapTokens: env.CHUNK_OVERLAP_TOKENS,
    },
    rag: {
      qualityThreshold: env.QUALITY_THRESHOLD,
      retrievalTopK: env.RETRIEVAL_TOP_K,
      rerankTopK: env.RERANK_TOP_K,
      maxContextTokens: env.MAX_CONTEXT_TOKENS,
    },
    reliability: {
      faithfulnessThreshold: env.FAITHFULNESS_THRESHOLD,
      hallucinationThreshold: env.HALLUCINATION_THRESHOLD,
    },
  };
}

export type ConfigKey = keyof AppConfig;
