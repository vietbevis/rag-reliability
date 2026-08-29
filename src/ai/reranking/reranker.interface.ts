import type { RerankedChunk, RetrievedChunk } from '../../common/types';

/**
 * Kết quả reranking trả về từ RerankerService.
 */
export interface RerankResult {
  chunks: RerankedChunk[];
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
  latencyMs: number;
  method: string; // tên provider ĐÃ dùng
  fellBack: boolean; // true nếu provider lỗi → fallback identity
}

/**
 * Kết quả chi tiết tuỳ chọn từ RerankerProvider kèm usage token.
 */
export interface ProviderRerankResult {
  chunks: RerankedChunk[];
  usage?: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

/**
 * Hợp đồng reranker (PROMPT §19).
 *
 * Ghi chú: `rerank()` của provider CÓ THỂ ném lỗi; `RerankerService` là nơi
 * bắt lỗi + fallback về identity để một lỗi reranker không bao giờ làm hỏng
 * truy vấn (PROMPT §54).
 */
export interface RerankerProvider {
  readonly name: string;
  isConfigured(): boolean;

  /**
   * Rerank danh sách chunk theo query và cắt topK.
   * Có thể ném lỗi nếu provider gặp sự cố — RerankerService sẽ xử lý fallback.
   */
  rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<RerankedChunk[] | ProviderRerankResult>;
}

export const RERANKER_PROVIDER = Symbol('RERANKER_PROVIDER');
