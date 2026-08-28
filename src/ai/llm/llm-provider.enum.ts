/** Các back-end LLM được hỗ trợ. Chọn qua `LLM_PROVIDER` (PROMPT §4). */
export enum LlmProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
  CUSTOM = 'custom',
}

/** Các back-end tạo embedding. Chọn qua `EMBEDDING_PROVIDER`. */
export enum EmbeddingProviderName {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  CUSTOM = 'custom',
  /** Tất định, seed theo hash — chỉ cho CI/dev, không có ý nghĩa ngữ nghĩa. */
  FAKE = 'fake',
}

export const ALL_LLM_PROVIDERS: readonly LlmProvider[] =
  Object.values(LlmProvider);

export const ALL_EMBEDDING_PROVIDERS: readonly EmbeddingProviderName[] =
  Object.values(EmbeddingProviderName);
