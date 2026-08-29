import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import type {
  ChunkingInput,
  ChunkingStrategy,
  RawChunk,
} from './chunking.interface';

/**
 * Semantic chunking (PROMPT §12, §36 — trước đây thiếu, xem
 * docs/audit/RETRIEVAL_BENCHMARK.md §1).
 *
 * Ý tưởng: tách văn bản thành câu → embedding từng câu (có đệm) → tính khoảng
 * cách cosine giữa các câu liền kề → cắt tại những chỗ khoảng cách vượt phân vị
 * ngưỡng (`SEMANTIC_BREAKPOINT_PERCENTILE`). Sau đó ép về khoảng token
 * [minTokens, maxTokens]: gộp nhóm quá nhỏ, cắt cứng nhóm quá lớn.
 *
 * Nếu provider embedding chưa cấu hình hoặc quá ít câu → fallback đóng gói đoạn
 * (blank-line) theo maxTokens, KHÔNG làm hỏng ingestion.
 */
@Injectable()
export class SemanticChunkerService implements ChunkingStrategy {
  readonly name = 'semantic' as const;
  private readonly logger = new Logger(SemanticChunkerService.name);
  private readonly maxTokens: number;
  private readonly minTokens: number;
  private readonly percentile: number;
  private readonly bufferSize: number;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenCounterService,
    private readonly embeddings: EmbeddingService,
  ) {
    const c = config.get('chunking', { infer: true });
    this.maxTokens = c.maxTokens;
    this.minTokens = c.minTokens;
    this.percentile = c.semanticBreakpointPercentile;
    this.bufferSize = c.semanticBufferSize;
  }

  async split(input: ChunkingInput): Promise<RawChunk[]> {
    const text = (input.text ?? '').trim();
    if (!text) return [];

    const sentences = splitSentences(text);

    if (sentences.length < 4 || !this.embeddings.isConfigured()) {
      return this.fallbackPack(text, 'semantic-fallback-pack');
    }

    let breakpoints: Set<number>;
    try {
      breakpoints = await this.computeBreakpoints(sentences);
    } catch (err) {
      this.logger.warn(
        `Semantic chunking lỗi embedding, fallback đóng gói đoạn: ${(err as Error).message}`,
      );
      return this.fallbackPack(text, 'semantic-fallback-embed-error');
    }

    // Gom câu thành nhóm theo breakpoint.
    const groups: string[] = [];
    let current: string[] = [];
    for (let i = 0; i < sentences.length; i++) {
      current.push(sentences[i]!);
      if (breakpoints.has(i) && current.length > 0) {
        groups.push(current.join(' '));
        current = [];
      }
    }
    if (current.length > 0) groups.push(current.join(' '));

    return this.enforceTokenBounds(groups, 'semantic-breakpoint');
  }

  /** Chỉ số câu i mà sau nó là điểm cắt (distance(i, i+1) > ngưỡng phân vị). */
  private async computeBreakpoints(sentences: string[]): Promise<Set<number>> {
    const windows = sentences.map((_, i) => {
      const from = Math.max(0, i - this.bufferSize);
      const to = Math.min(sentences.length, i + this.bufferSize + 1);
      return sentences.slice(from, to).join(' ');
    });

    const { vectors } = await this.embeddings.embedBatch(windows, {
      inputType: 'passage',
    });

    const distances: number[] = [];
    for (let i = 0; i < vectors.length - 1; i++) {
      distances.push(1 - cosineSim(vectors[i]!, vectors[i + 1]!));
    }

    const threshold = percentile(distances, this.percentile);
    const breakpoints = new Set<number>();
    for (let i = 0; i < distances.length; i++) {
      if (distances[i]! > threshold) breakpoints.add(i);
    }
    return breakpoints;
  }

  /** Gộp nhóm < minTokens về phía trước, cắt cứng nhóm > maxTokens. */
  private enforceTokenBounds(
    groups: string[],
    splitReason: string,
  ): RawChunk[] {
    const merged: string[] = [];
    for (const g of groups) {
      const prev = merged[merged.length - 1];
      if (
        prev !== undefined &&
        this.tokens.count(prev) < this.minTokens &&
        this.tokens.count(prev) + this.tokens.count(g) <= this.maxTokens
      ) {
        merged[merged.length - 1] = `${prev} ${g}`;
      } else {
        merged.push(g);
      }
    }

    const out: RawChunk[] = [];
    for (const piece of merged) {
      for (const sub of this.hardSplit(piece)) {
        const content = sub.trim();
        if (!content) continue;
        out.push({
          content,
          metadata: {
            splitReason,
            sequence: out.length,
            tokenCount: this.tokens.count(content),
          },
        });
      }
    }
    return out;
  }

  /** Cắt cứng theo câu khi một nhóm vượt maxTokens. */
  private hardSplit(piece: string): string[] {
    if (this.tokens.count(piece) <= this.maxTokens) return [piece];
    const parts: string[] = [];
    let buf: string[] = [];
    for (const s of splitSentences(piece)) {
      buf.push(s);
      if (this.tokens.count(buf.join(' ')) >= this.maxTokens) {
        parts.push(buf.join(' '));
        buf = [];
      }
    }
    if (buf.length > 0) parts.push(buf.join(' '));
    return parts;
  }

  private fallbackPack(text: string, splitReason: string): RawChunk[] {
    const paras = text
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return this.enforceTokenBounds(
      paras.length > 0 ? paras : [text],
      splitReason,
    );
  }
}

/** Tách câu tiếng Việt: xuống dòng + dấu kết câu. Giữ heading Markdown thành câu riêng. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    for (const s of trimmed.split(/(?<=[.!?…:])\s+/)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Phân vị tuyến tính (p ∈ [0,100]). Mảng rỗng → 0. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!);
}
