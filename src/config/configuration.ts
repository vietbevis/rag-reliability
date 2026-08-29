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
    minRelevance: number;
    minChunks: number;
    temperature: number;
  };
  grounding: {
    strict: boolean;
    abstainMinRelevance: number;
    minGroundingRatio: number;
    regenerateOnUngrounded: boolean;
  };
  citation: {
    enabled: boolean;
    minOverlap: number;
    maxPerClaim: number;
    relationshipCitations: boolean;
    minAnswerTokens: number;
  };
  rerank: {
    enabled: boolean;
    provider: 'none' | 'fake' | 'llm';
    candidates: number;
    topK: number;
  };
  reliability: {
    faithfulnessThreshold: number;
    hallucinationThreshold: number;
  };
  faithfulness: {
    enabled: boolean;
    verifierMode: 'auto' | 'heuristic' | 'llm';
    threshold: number;
    regenerateOnUnfaithful: boolean;
  };
  graph: {
    /** Công tắc tính năng Graph RAG (PROMPT §47 mở rộng). */
    enabled: boolean;
    neo4j: {
      uri?: string;
      user: string;
      password?: string;
      maxPoolSize: number;
      queryTimeoutMs: number;
    };
    extract: {
      maxTokens: number;
      gleanings: number;
      maxLlmCallsPerDoc: number;
      entityTypes: string[];
      promptVersion: string;
    };
    /** Traversal + entity linking cho GraphRetriever (PHASE 6). */
    retrieval: {
      maxHops: number;
      maxEntityDegree: number;
      topK: number;
      linkUseLlm: boolean;
    };
  };
  /** Hợp nhất kết quả nhiều retriever (PHASE 6). */
  retrieval: {
    strategy: 'vector' | 'keyword' | 'graph' | 'hybrid';
    fusion: {
      method: 'rrf' | 'weighted';
      rrfK: number;
      weights: { vector: number; keyword: number; graph: number };
    };
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
      minRelevance: env.RAG_MIN_RELEVANCE,
      minChunks: env.RAG_MIN_CHUNKS,
      temperature: env.RAG_TEMPERATURE,
    },
    grounding: {
      strict: env.RAG_STRICT_GROUNDING,
      abstainMinRelevance: env.RAG_ABSTAIN_MIN_RELEVANCE,
      minGroundingRatio: env.RAG_MIN_GROUNDING_RATIO,
      regenerateOnUngrounded: env.RAG_REGENERATE_ON_UNGROUNDED,
    },
    citation: {
      enabled: env.RAG_CITATION_ENABLED,
      minOverlap: env.CITATION_MIN_OVERLAP,
      maxPerClaim: env.CITATION_MAX_PER_CLAIM,
      relationshipCitations: env.CITATION_RELATIONSHIP_ENABLED,
      minAnswerTokens: env.CITATION_MIN_ANSWER_TOKENS,
    },
    rerank: {
      enabled: env.RERANK_ENABLED,
      provider: env.RERANK_PROVIDER,
      candidates: env.RERANK_CANDIDATES,
      topK: env.RERANK_TOP_K,
    },
    reliability: {
      faithfulnessThreshold: env.FAITHFULNESS_THRESHOLD,
      hallucinationThreshold: env.HALLUCINATION_THRESHOLD,
    },
    faithfulness: {
      enabled: env.RAG_FAITHFULNESS_ENABLED,
      verifierMode: env.FAITHFULNESS_VERIFIER_MODE,
      threshold: env.FAITHFULNESS_THRESHOLD,
      regenerateOnUnfaithful: env.RAG_REGENERATE_ON_UNFAITHFUL,
    },
    graph: {
      enabled: env.GRAPH_RAG_ENABLED,
      neo4j: {
        uri: env.NEO4J_URI,
        user: env.NEO4J_USER,
        password: env.NEO4J_PASSWORD,
        maxPoolSize: env.NEO4J_MAX_POOL_SIZE,
        queryTimeoutMs: env.NEO4J_QUERY_TIMEOUT_MS,
      },
      extract: {
        maxTokens: env.GRAPH_EXTRACT_MAX_TOKENS,
        gleanings: env.GRAPH_EXTRACT_GLEANINGS,
        maxLlmCallsPerDoc: env.GRAPH_EXTRACT_MAX_LLM_CALLS_PER_DOC,
        entityTypes: env.GRAPH_ENTITY_TYPES,
        promptVersion: env.GRAPH_PROMPT_VERSION,
      },
      retrieval: {
        maxHops: env.GRAPH_MAX_HOPS,
        maxEntityDegree: env.GRAPH_MAX_ENTITY_DEGREE,
        topK: env.GRAPH_RETRIEVAL_TOP_K,
        linkUseLlm: env.GRAPH_LINK_USE_LLM,
      },
    },
    retrieval: {
      strategy: env.RETRIEVAL_STRATEGY,
      fusion: {
        method: env.FUSION_METHOD,
        rrfK: env.FUSION_RRF_K,
        weights: {
          vector: env.FUSION_WEIGHT_VECTOR,
          keyword: env.FUSION_WEIGHT_KEYWORD,
          graph: env.FUSION_WEIGHT_GRAPH,
        },
      },
    },
  };
}

export type ConfigKey = keyof AppConfig;
