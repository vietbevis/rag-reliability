import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type {
  ChunkingInput,
  ChunkingStrategy,
  RawChunk,
} from './chunking.interface';
import {
  parseMarkdownSections,
  type MdBlock,
  type MdSection,
} from './markdown-blocks';

interface Bounds {
  max: number;
  min: number;
  overlap: number;
}

/**
 * Chunking bám cấu trúc Markdown (PROMPT §12):
 *
 *   Document -> Heading -> Section -> Block (đoạn/bảng/list/code) -> gói theo token
 *
 * Nguyên tắc:
 * - Không cắt giữa một block nếu block đó vừa trong `CHUNK_MAX_TOKENS`.
 * - Block quá lớn -> tách theo câu, rồi theo cửa sổ token có overlap.
 * - Section quá nhỏ (`< CHUNK_MIN_TOKENS`) -> gộp vào chunk trước nếu cùng
 *   nhánh heading và tổng vẫn <= max.
 * - Mỗi chunk mang `heading` + breadcrumb `section` để không "thiếu context".
 */
@Injectable()
export class StructureAwareChunkerService implements ChunkingStrategy {
  readonly name = 'structure' as const;
  private readonly bounds: Bounds;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenCounterService,
  ) {
    const c = config.get('chunking', { infer: true });
    this.bounds = {
      max: c.maxTokens,
      min: c.minTokens,
      overlap: c.overlapTokens,
    };
  }

  split(input: ChunkingInput): Promise<RawChunk[]> {
    const source = input.markdown?.trim() || input.text;
    const sections = parseMarkdownSections(source);
    const chunks: RawChunk[] = [];

    for (const section of sections) {
      const sectionChunks = this.chunkSection(section);
      for (const sc of sectionChunks) {
        const merged = this.tryMergeWithPrevious(chunks, sc, section);
        if (!merged) chunks.push(sc);
      }
    }

    return Promise.resolve(chunks.map((c, i) => this.finalize(c, i)));
  }

  // --- section -> chunks --------------------------------------------------

  private chunkSection(section: MdSection): RawChunk[] {
    const heading = section.headingPath.at(-1);
    const breadcrumb = section.headingPath.join(' > ') || undefined;
    const base = (): RawChunk => ({
      content: '',
      heading,
      section: breadcrumb,
      metadata: {
        headingPath: section.headingPath,
        headingLevel: section.level,
        splitReason: 'section-packed',
      },
    });

    const out: RawChunk[] = [];
    let buf: string[] = [];

    const flush = (reason: string): void => {
      if (buf.length === 0) return;
      const chunk = base();
      chunk.content = buf.join('\n\n');
      chunk.metadata.splitReason = reason;
      out.push(chunk);
      buf = [];
    };

    for (const block of section.blocks) {
      if (this.tokens.count(block.text) > this.bounds.max) {
        flush('section-packed');
        for (const piece of this.splitOversizedBlock(block)) {
          const chunk = base();
          chunk.content = piece;
          chunk.metadata.splitReason = 'block-oversized-split';
          out.push(chunk);
        }
        continue;
      }

      buf.push(block.text);
      if (
        buf.length > 1 &&
        this.tokens.count(buf.join('\n\n')) > this.bounds.max
      ) {
        buf.pop();
        flush('section-packed');
        buf.push(block.text);
      }
    }
    flush(out.length === 0 ? 'section-fit' : 'section-packed');

    return out;
  }

  /** Block > max: tách theo câu (hoặc dòng), gói theo cửa sổ token có overlap. */
  private splitOversizedBlock(block: MdBlock): string[] {
    const sep = block.type === 'code' || block.type === 'table' ? '\n' : ' ';
    let units =
      sep === '\n' ? block.text.split('\n') : splitSentences(block.text);

    // Bảng GFM quá lớn: giữ 2 dòng đầu (header + separator) và LẶP LẠI ở mọi
    // mảnh sau đó, để LLM biết cột nào là cột nào khi bảng bị cắt.
    let tableHeader: string[] = [];
    if (
      block.type === 'table' &&
      units.length > 2 &&
      /^\s*\|/.test(units[1] ?? '')
    ) {
      tableHeader = units.slice(0, 2);
      units = units.slice(2);
    }

    const pieces: string[] = [];
    let buf: string[] = [...tableHeader];

    const joined = (): string => buf.join(sep).trim();

    for (const unit of units) {
      buf.push(unit);
      if (buf.length > 1 && this.tokens.count(joined()) > this.bounds.max) {
        buf.pop();
        pieces.push(joined());

        // overlap: giữ lại phần cuối của piece vừa đóng, nhưng không để phần
        // overlap + header bảng + unit hiện tại vượt max (nếu vượt thì bỏ overlap).
        const headerTokens = tableHeader.length
          ? this.tokens.count(tableHeader.join(sep))
          : 0;
        const unitTokens = this.tokens.count(unit);
        const carry: string[] = [];
        let carryTokens = 0;
        for (
          let k = buf.length - 1;
          k >= tableHeader.length &&
          carryTokens < this.bounds.overlap &&
          headerTokens +
            carryTokens +
            this.tokens.count(buf[k]!) +
            unitTokens <=
            this.bounds.max;
          k--
        ) {
          carry.unshift(buf[k]!);
          carryTokens += this.tokens.count(buf[k]!);
        }
        buf = [...tableHeader, ...carry, unit];
      }
    }
    if (buf.length > 0) pieces.push(joined());
    return pieces;
  }

  /** Gộp section nhỏ vào chunk trước nếu cùng nhánh heading & tổng <= max. */
  private tryMergeWithPrevious(
    chunks: RawChunk[],
    candidate: RawChunk,
    section: MdSection,
  ): boolean {
    const prev = chunks.at(-1);
    if (!prev) return false;
    if (this.tokens.count(candidate.content) >= this.bounds.min) return false;

    const prevPath = (prev.metadata.headingPath as string[] | undefined) ?? [];
    const sameBranch =
      section.headingPath.length > 0 &&
      prevPath[0] !== undefined &&
      prevPath[0] === section.headingPath[0];
    if (!sameBranch) return false;

    const combined = `${prev.content}\n\n${candidate.content}`;
    if (this.tokens.count(combined) > this.bounds.max) return false;

    prev.content = combined;
    prev.metadata.splitReason = 'small-section-merged';
    prev.metadata.mergedSections = [
      ...((prev.metadata.mergedSections as string[] | undefined) ?? []),
      section.headingPath.join(' > '),
    ];
    return true;
  }

  private finalize(chunk: RawChunk, sequence: number): RawChunk {
    return {
      ...chunk,
      content: chunk.content.trim(),
      metadata: {
        ...chunk.metadata,
        sequence,
        tokenCount: this.tokens.count(chunk.content),
      },
    };
  }
}

/** Tách câu thô, giữ dấu kết câu; đủ tốt cho tiếng Việt/Anh. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“([])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
