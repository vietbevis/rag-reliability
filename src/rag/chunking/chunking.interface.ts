/**
 * Hợp đồng cho các chiến lược chunking (PROMPT §12, §35, §36).
 *
 * - `structure`: bám cấu trúc Markdown (heading -> section -> block), giữ
 *   nguyên semantic unit khi có thể.
 * - `fixed`: cửa sổ token cố định + overlap (baseline để benchmark).
 * - `semantic`: cắt tại ranh giới ngữ nghĩa — khoảng cách embedding giữa các câu
 *   liền kề vượt phân vị ngưỡng (`SEMANTIC_BREAKPOINT_PERCENTILE`).
 *
 * RAG core chỉ phụ thuộc interface này; đổi chiến lược bằng env
 * `CHUNKING_STRATEGY`, không sửa code.
 */

export type ChunkingStrategyName = 'structure' | 'fixed' | 'semantic';

export interface ChunkingInput {
  /** Markdown từ anydoc, nếu có (chunker structure ưu tiên dùng). */
  markdown?: string;
  /** Text đã clean (luôn có). */
  text: string;
}

export interface RawChunk {
  content: string;
  /** Heading trực tiếp của phần chứa chunk (nếu có). */
  heading?: string;
  /** Đường dẫn breadcrumb, vd "Quy chế > Chương I > Điều 5". */
  section?: string;
  /** Số trang nguồn (nếu parser cung cấp). */
  page?: number;
  /** headingPath[], headingLevel, splitReason, hasOverlap... */
  metadata: Record<string, unknown>;
}

export interface ChunkingStrategy {
  readonly name: ChunkingStrategyName;
  split(input: ChunkingInput): Promise<RawChunk[]>;
}

export const CHUNKING_STRATEGY = Symbol('CHUNKING_STRATEGY');
