/**
 * Các hợp đồng có kiểu cho từng stage của pipeline RAG (PROMPT §53).
 *
 * Những interface này là từ vựng chung giữa các module. Không có `any` nào đi
 * qua ranh giới giữa các stage. PHASE 0 định nghĩa shape; các phase sau hiện
 * thực các service sinh ra và tiêu thụ chúng.
 */

export type ParserType = 'anydoc' | 'plaintext' | 'html' | 'fallback';

export type DocumentStatus =
  | 'UPLOADED'
  | 'PARSING'
  | 'CLEANING'
  | 'VALIDATING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

export type RagStatus =
  | 'GROUNDED'
  | 'PARTIALLY_GROUNDED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTING_EVIDENCE';

export type HallucinationRootCause =
  | 'RETRIEVAL_FAILURE'
  | 'BAD_SOURCE_DATA'
  | 'MISSING_CONTEXT'
  | 'IRRELEVANT_CONTEXT'
  | 'CONFLICTING_CONTEXT'
  | 'GENERATION_HALLUCINATION'
  | 'CITATION_HALLUCINATION';

/** Một tài liệu như khi vừa nhận, trước mọi xử lý. */
export interface RawDocument {
  title: string;
  source: string;
  mimeType: string;
  bytes: Uint8Array;
  metadata: Record<string, unknown>;
}

/** Output của parser anydoc (hoặc fallback). */
export interface ParsedDocument {
  markdown: string;
  text: string;
  parser: ParserType;
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface QualityIssue {
  type: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  location?: string;
}

export interface QualityReport {
  score: number;
  valid: boolean;
  issues: QualityIssue[];
}

/** Tài liệu đã được clean, normalize, kiểm tra chất lượng, sẵn sàng để chunk. */
export interface CleanDocument {
  checksum: string;
  cleanedText: string;
  parsedMarkdown: string;
  quality: QualityReport;
  transformations: string[];
  metadata: Record<string, unknown>;
}

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  content: string;
  sequence: number;
  tokenCount: number;
  section?: string;
  page?: number;
  heading?: string;
  metadata: Record<string, unknown>;
}

export interface EmbeddingVector {
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  vector: number[];
}

export interface RetrievalQuery {
  query: string;
  topK: number;
  filters?: Record<string, unknown>;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
  metadata: Record<string, unknown>;
}

export interface RerankedChunk extends RetrievedChunk {
  rerankScore: number;
  rank: number;
}

export interface GroundingContext {
  chunks: RerankedChunk[];
  totalTokens: number;
  sources: Array<{ documentId: string; chunkIds: string[] }>;
}

export interface Claim {
  id: string;
  text: string;
}

export interface Evidence {
  claimId: string;
  supported: boolean;
  evidenceChunkIds: string[];
  verdict: 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED';
}

export interface Citation {
  claimId: string;
  claimText: string;
  documentId: string;
  chunkId: string;
  page?: number;
  section?: string;
  valid: boolean;
}

export interface GeneratedAnswer {
  answer: string;
  status: RagStatus;
  claims: Claim[];
  citationIds: string[];
}

export interface FaithfulnessResult {
  score: number;
  grounded: boolean;
  claims: Evidence[];
  rootCause?: HallucinationRootCause;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  metrics: Record<string, number>;
  failureLayer?: HallucinationRootCause;
  notes?: string;
}
