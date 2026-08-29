import { LlmProvider } from './llm-provider.enum';

/**
 * Bảng giá theo model, tính bằng USD cho mỗi 1.000 token (PROMPT §56 — chi phí
 * phải theo từng provider). Đây là giá niêm yết gần đúng; có thể override qua
 * config sau nếu cần. Model không rõ sẽ dùng giá mặc định của provider để chi
 * phí không bao giờ bị 0 một cách âm thầm.
 */
export interface ModelPrice {
  inputPer1k: number;
  outputPer1k: number;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4.1': { inputPer1k: 0.002, outputPer1k: 0.008 },
  'gpt-4.1-mini': { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  'text-embedding-3-small': { inputPer1k: 0.00002, outputPer1k: 0 },
  'text-embedding-3-large': { inputPer1k: 0.00013, outputPer1k: 0 },
  // Google Gemini
  'gemini-2.5-flash': { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  'gemini-2.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.01 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'text-embedding-004': { inputPer1k: 0, outputPer1k: 0 },
  // Anthropic
  'claude-sonnet-4-20250514': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-sonnet-20241022': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-haiku-20241022': { inputPer1k: 0.0008, outputPer1k: 0.004 },
};

const PROVIDER_DEFAULT: Record<LlmProvider, ModelPrice> = {
  [LlmProvider.OPENAI]: { inputPer1k: 0.0025, outputPer1k: 0.01 },
  [LlmProvider.GEMINI]: { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  [LlmProvider.ANTHROPIC]: { inputPer1k: 0.003, outputPer1k: 0.015 },
  [LlmProvider.CUSTOM]: { inputPer1k: 0, outputPer1k: 0 },
  [LlmProvider.FAKE]: { inputPer1k: 0, outputPer1k: 0 },
};

export function getModelPrice(
  provider: LlmProvider,
  model: string,
): ModelPrice {
  return PRICES[model] ?? PROVIDER_DEFAULT[provider];
}

/** Chi phí USD ước tính cho một lần gọi. Làm tròn tới 6 chữ số thập phân. */
export function estimateCost(
  provider: LlmProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = getModelPrice(provider, model);
  const cost =
    (inputTokens / 1000) * price.inputPer1k +
    (outputTokens / 1000) * price.outputPer1k;
  return Math.round(cost * 1e6) / 1e6;
}
