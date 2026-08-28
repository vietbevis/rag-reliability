import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { AppConfig } from '../../config/configuration';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type {
  ChunkingInput,
  ChunkingStrategy,
  RawChunk,
} from './chunking.interface';

/**
 * Baseline chunker (PROMPT §35): cửa sổ token cố định + overlap, KHÔNG quan tâm
 * cấu trúc. Dùng `RecursiveCharacterTextSplitter` của LangChain với hàm đo độ
 * dài theo token (nhất quán với cost tracking). Đây là mốc để so sánh với
 * structure-aware chunking (Experiment 001).
 */
@Injectable()
export class FixedSizeChunkerService implements ChunkingStrategy {
  readonly name = 'fixed' as const;
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenCounterService,
  ) {
    const c = config.get('chunking', { infer: true });
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: c.maxTokens,
      chunkOverlap: c.overlapTokens,
      lengthFunction: (text: string) => this.tokens.count(text),
    });
  }

  async split(input: ChunkingInput): Promise<RawChunk[]> {
    // Baseline dùng text đã clean (không dùng cấu trúc Markdown).
    const pieces = await this.splitter.splitText(input.text);
    return pieces
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content, sequence) => ({
        content,
        metadata: {
          splitReason: 'fixed-window',
          sequence,
          tokenCount: this.tokens.count(content),
        },
      }));
  }
}
