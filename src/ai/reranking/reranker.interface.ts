import type { RerankedChunk, RetrievedChunk } from '../../common/types';

/**
 * Hợp đồng reranker (PROMPT §19). PHASE 0 chỉ định nghĩa shape — các hiện thực
 * dựa trên LLM và API bên ngoài sẽ đến ở PHASE 6, nơi chạy benchmark trước/sau
 * khi rerank. Mọi hiện thực BẮT BUỘC phải có xếp hạng fallback để một lỗi
 * reranker không bao giờ làm hỏng truy vấn (PROMPT §54).
 */
export interface RerankerProvider {
  readonly name: string;
  isConfigured(): boolean;

  rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<RerankedChunk[]>;
}

export const RERANKER_PROVIDER = Symbol('RERANKER_PROVIDER');
