import type { TokenUsage } from '../../common/types';
import type { EmbeddingProviderName } from '../llm/llm-provider.enum';

export interface EmbeddingResult {
  vector: number[];
  usage: TokenUsage;
  model: string;
}

export interface EmbeddingBatchResult {
  vectors: number[][];
  usage: TokenUsage;
  model: string;
}

/**
 * Hợp đồng cho mọi back-end embedding (PROMPT §4.3, §14). Lõi RAG chỉ phụ
 * thuộc vào interface này — không bao giờ phụ thuộc vào một provider cụ thể.
 */
export interface EmbeddingProvider {
  readonly provider: EmbeddingProviderName;
  /** Số chiều đầu ra kỳ vọng (từ config; được kiểm tra lại với output thực). */
  readonly dimensions: number;
  readonly defaultModel: string;
  isConfigured(): boolean;

  embed(text: string): Promise<EmbeddingResult>;

  /** Embedding theo lô — nơi gọi không bao giờ được lặp `embed()` từng item (PROMPT §55). */
  embedBatch(texts: string[]): Promise<EmbeddingBatchResult>;
}
