import type {
  RetrievalFilters,
  RetrievalSource,
  RetrievedChunk,
} from '../../common/types';

export interface RetrieveOptions {
  query: string;
  topK: number;
  filters?: RetrievalFilters;
}

export interface RetrieverResult {
  chunks: RetrievedChunk[];
  latencyMs: number;
  /** Số token embedding (nếu retriever cần embed query). */
  embeddingTokens: number;
  /** Chi phí ước tính của retriever (embedding query, LLM entity-linking...). */
  estimatedCost: number;
  /** Thông tin debug cho trace (PROMPT §38). */
  trace: Record<string, unknown>;
}

/**
 * Hợp đồng chung cho mọi cách truy hồi (PROMPT §16-19). Vector (P4), keyword
 * + graph (P6) đều implement interface này để fusion (P6) hợp nhất được.
 * Retriever KHÔNG bao giờ ném khi "không tìm thấy" — trả `chunks: []`.
 * Lỗi hạ tầng (Neo4j chết, embedding fail) → trả rỗng + ghi `trace.error`
 * (PROMPT §54), để fusion vẫn chạy với các nguồn còn lại.
 */
export interface Retriever {
  readonly source: RetrievalSource;
  retrieve(options: RetrieveOptions): Promise<RetrieverResult>;
}

export const emptyResult = (
  trace: Record<string, unknown> = {},
): RetrieverResult => ({
  chunks: [],
  latencyMs: 0,
  embeddingTokens: 0,
  estimatedCost: 0,
  trace,
});
