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

export type RetrievalSource = 'vector' | 'keyword' | 'graph' | 'hybrid';

export interface RetrievalFilters {
  documentIds?: string[];
  sources?: string[];
  /** Lọc theo khoá trong `DocumentChunk.metadata` (khớp bằng nhau). */
  metadata?: Record<string, string | number | boolean>;
}

export interface RetrievalQuery {
  query: string;
  topK: number;
  filters?: RetrievalFilters;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  /** Điểm tương đồng đã chuẩn hoá về [0,1] (cao = liên quan hơn). */
  score: number;
  source: RetrievalSource;
  heading?: string;
  section?: string;
  page?: number;
  metadata: Record<string, unknown>;
}

export interface RerankedChunk extends RetrievedChunk {
  rerankScore: number;
  rank: number;
}

export interface GroundingContext {
  chunks: RetrievedChunk[];
  totalTokens: number;
  sources: Array<{ documentId: string; chunkIds: string[] }>;
}

export interface Claim {
  id: string;
  text: string;
}

/** Claim kèm kết quả đối chiếu evidence — hình dạng trả trong response (§24-25). */
export interface VerifiedClaim {
  id: string;
  text: string;
  supported: boolean;
  verdict: 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED';
  evidenceChunkIds: string[];
}

export interface Evidence {
  claimId: string;
  supported: boolean;
  evidenceChunkIds: string[];
  verdict: 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED';
  /** Độ khớp từ vựng cao nhất giữa claim và chunk [0,1] (§25 proxy). */
  score: number;
}

export type CitationKind = 'chunk' | 'relationship';

export interface Citation {
  claimId: string;
  claimText: string;
  /** 'chunk' = claim → chunk → document; 'relationship' = claim → cạnh RELATED. */
  kind: CitationKind;
  documentId: string;
  chunkId: string;
  page?: number;
  section?: string;
  /** Chỉ khi kind = 'relationship' (graph-rag.md §5). */
  sourceEntity?: string;
  targetEntity?: string;
  relationType?: string;
  /** Backend map được claim → evidence → nguồn cụ thể (§29). Không map được → false. */
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
