import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { GroundingContext, RetrievedChunk } from '../../common/types';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';

/** Token ước tính cho separator `\n\n---\n\n` giữa hai chunk trong prompt. */
const SEPARATOR_TOKENS = 5;

/**
 * Dựng context cho generation (PROMPT §21). KHÔNG đưa raw retrieval thẳng vào
 * prompt:
 * - bỏ chunk trùng (theo chunkId),
 * - sắp theo relevance,
 * - giữ metadata nguồn (documentId, heading/section, page),
 * - áp trần token `MAX_CONTEXT_TOKENS`.
 */
@Injectable()
export class ContextBuilderService {
  private readonly maxTokens: number;

  constructor(
    private readonly tokens: TokenCounterService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.maxTokens = config.get('rag', { infer: true }).maxContextTokens;
  }

  build(
    chunks: RetrievedChunk[],
    maxTokens = this.maxTokens,
  ): GroundingContext {
    const deduped = new Map<string, RetrievedChunk>();
    for (const c of chunks) {
      const existing = deduped.get(c.chunkId);
      if (!existing || c.score > existing.score) deduped.set(c.chunkId, c);
    }

    const sorted = [...deduped.values()].sort((a, b) => b.score - a.score);

    const kept: RetrievedChunk[] = [];
    let totalTokens = 0;
    for (const c of sorted) {
      // Đếm sát với `renderContext` thực tế: có nhãn `[i] ` + separator
      // `\n\n---\n\n` giữa các chunk (~SEPARATOR_TOKENS).
      const t =
        this.tokens.count(this.render(c, kept.length)) +
        (kept.length > 0 ? SEPARATOR_TOKENS : 0);
      if (kept.length > 0 && totalTokens + t > maxTokens) continue;
      kept.push(c);
      totalTokens += t;
      if (totalTokens >= maxTokens) break;
    }

    const bySource = new Map<string, Set<string>>();
    for (const c of kept) {
      if (!bySource.has(c.documentId)) bySource.set(c.documentId, new Set());
      bySource.get(c.documentId)!.add(c.chunkId);
    }

    return {
      chunks: kept,
      totalTokens,
      sources: [...bySource.entries()].map(([documentId, ids]) => ({
        documentId,
        chunkIds: [...ids],
      })),
    };
  }

  /** Định dạng một chunk để đưa vào prompt: có nhãn `[i]` + breadcrumb nguồn. */
  render(chunk: RetrievedChunk, index?: number): string {
    const label = index === undefined ? '' : `[${index + 1}] `;
    const crumb = chunk.section
      ? `(${chunk.section}${chunk.page ? `, tr.${chunk.page}` : ''}) `
      : '';
    return `${label}${crumb}${chunk.content}`.trim();
  }

  /** Toàn bộ context thành một khối text đánh số cho prompt. */
  renderContext(context: GroundingContext): string {
    return context.chunks.map((c, i) => this.render(c, i)).join('\n\n---\n\n');
  }
}
