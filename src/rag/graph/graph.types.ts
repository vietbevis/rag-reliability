/**
 * Kiểu dùng chung cho Graph RAG construction (PHASE 5). Xem
 * `docs/architecture/graph-rag.md`.
 */

/** Một thực thể do LLM trích ra từ MỘT chunk (chưa resolve). */
export interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

/** Một quan hệ do LLM trích ra từ MỘT chunk (chưa resolve). */
export interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
  description: string;
  /** Mức độ tin cậy/nổi bật 1..10 (LLM tự đánh giá). */
  strength: number;
}

/** Kết quả extraction cho một chunk (đã post-validate, có thể lấy từ cache). */
export interface ChunkExtraction {
  chunkId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  fromCache: boolean;
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
  llmCalls: number;
}

/** Thực thể sau khi gộp theo `key` trong phạm vi một tài liệu. */
export interface ResolvedEntity {
  key: string;
  name: string;
  type: string;
  description: string;
  /** chunkId chứa thực thể này (để tạo cạnh MENTIONED_IN). */
  chunkIds: string[];
}

/** Quan hệ sau khi gộp theo cặp thực thể + loại, trong phạm vi một tài liệu. */
export interface ResolvedRelationship {
  key: string;
  sourceKey: string;
  targetKey: string;
  type: string;
  description: string;
  /** chunkId chứng thực quan hệ (weight = số chunk = size(chunkIds)). */
  chunkIds: string[];
}

/** Đồ thị đã resolve cho một tài liệu — đầu vào của `GraphWriteService`. */
export interface ResolvedGraph {
  documentId: string;
  chunkIds: string[];
  entities: ResolvedEntity[];
  relationships: ResolvedRelationship[];
}

/** Số liệu ghi vào `IngestionJob` stage `GRAPH` (graph-rag.md §9). */
export interface GraphIngestionMetrics {
  entityCount: number;
  relationshipCount: number;
  chunkCount: number;
  llmCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  ms: number;
}

export interface GraphIngestionResult {
  documentId: string;
  skipped: boolean;
  /** Lý do khi `skipped` (vd graph tắt) hoặc lỗi hạ tầng (không ném). */
  reason?: string;
  metrics?: GraphIngestionMetrics;
}
