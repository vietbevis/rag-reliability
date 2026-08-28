import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration';
import type { TokenUsage } from '../../../common/types';
import { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import type {
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingResult,
} from '../embedding.interface';

/**
 * Embedding TẤT ĐỊNH cho CI/dev (PROMPT §42 — cần test retrieval / pipeline mà
 * không có API key). Vector được sinh từ PRNG seed bằng `sha256(text)`, rồi
 * chuẩn hoá về đơn vị. KHÔNG có ý nghĩa ngữ nghĩa — text giống nhau cho vector
 * giống nhau, chỉ vậy. Không dùng cho production.
 */
@Injectable()
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = EmbeddingProviderName.FAKE;
  readonly defaultModel = 'fake-deterministic-v1';
  private readonly dim: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.dim = config.get('embedding', { infer: true }).dimension;
  }

  get dimensions(): number {
    return this.dim;
  }

  isConfigured(): boolean {
    return true;
  }

  embed(text: string): Promise<EmbeddingResult> {
    return Promise.resolve({
      vector: this.vectorFor(text),
      usage: usage(text),
      model: this.defaultModel,
    });
  }

  embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
    return Promise.resolve({
      vectors: texts.map((t) => this.vectorFor(t)),
      usage: texts.reduce<TokenUsage>(
        (acc, t) => {
          const u = usage(t);
          return {
            inputTokens: acc.inputTokens + u.inputTokens,
            outputTokens: 0,
            totalTokens: acc.totalTokens + u.totalTokens,
            estimatedCost: 0,
          };
        },
        { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      ),
      model: this.defaultModel,
    });
  }

  /** PRNG xorshift128 seed từ hash, tạo vector rồi normalize. */
  private vectorFor(text: string): number[] {
    const digest = createHash('sha256').update(text).digest();
    let s0 = digest.readUInt32LE(0) || 1;
    let s1 = digest.readUInt32LE(4) || 2;
    let s2 = digest.readUInt32LE(8) || 3;
    let s3 = digest.readUInt32LE(12) || 4;
    const next = (): number => {
      // xoshiro128+ — hàm output (s0 + s3) cho spread tốt hơn state thô.
      const result = (s0 + s3) >>> 0;
      const t = s1 << 9;
      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = (s3 << 11) | (s3 >>> 21);
      return result / 0x100000000;
    };

    const raw = Array.from({ length: this.dim }, () => next() * 2 - 1);
    const norm = Math.sqrt(raw.reduce((a, x) => a + x * x, 0)) || 1;
    return raw.map((x) => x / norm);
  }
}

function usage(text: string): TokenUsage {
  const t = Math.ceil(text.length / 4);
  return { inputTokens: t, outputTokens: 0, totalTokens: t, estimatedCost: 0 };
}
