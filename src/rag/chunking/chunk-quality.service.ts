import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

export type ChunkFlag =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'STARTS_MID_SENTENCE'
  | 'ENDS_MID_SENTENCE'
  | 'MISSING_CONTEXT'
  | 'HIGH_NOISE'
  | 'DUPLICATE';

export interface ChunkQualityInput {
  content: string;
  tokenCount: number;
  hasHeading: boolean;
  isDuplicate?: boolean;
}

export interface ChunkQualityResult {
  score: number;
  flags: ChunkFlag[];
}

const PENALTY: Record<ChunkFlag, number> = {
  TOO_SHORT: 0.3,
  TOO_LONG: 0.25,
  STARTS_MID_SENTENCE: 0.15,
  ENDS_MID_SENTENCE: 0.15,
  MISSING_CONTEXT: 0.2,
  HIGH_NOISE: 0.3,
  DUPLICATE: 0.5,
};

/**
 * Chấm điểm chất lượng từng chunk (PROMPT §13). KHÔNG loại bỏ chunk — chỉ gắn
 * cờ + điểm để retrieval/reranking và benchmark dùng.
 */
@Injectable()
export class ChunkQualityService {
  private readonly min: number;
  private readonly max: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const c = config.get('chunking', { infer: true });
    this.min = c.minTokens;
    this.max = c.maxTokens;
  }

  assess(input: ChunkQualityInput): ChunkQualityResult {
    const flags: ChunkFlag[] = [];
    const text = input.content.trim();

    if (input.tokenCount < this.min) flags.push('TOO_SHORT');
    if (input.tokenCount > this.max * 1.15) flags.push('TOO_LONG');
    if (!input.hasHeading) flags.push('MISSING_CONTEXT');
    if (input.isDuplicate) flags.push('DUPLICATE');

    if (startsMidSentence(text)) flags.push('STARTS_MID_SENTENCE');
    if (endsMidSentence(text)) flags.push('ENDS_MID_SENTENCE');

    const noise = noiseRatio(text);
    if (noise > 0.35) flags.push('HIGH_NOISE');

    let score = 1;
    for (const f of flags) score -= PENALTY[f];
    score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

    return { score, flags };
  }
}

function startsMidSentence(text: string): boolean {
  const first = text[0];
  if (!first) return false;
  // OK nếu bắt đầu bằng chữ hoa, số, dấu mở, hoặc marker Markdown.
  if (/[\p{Lu}\p{N}"“('[#>|*\-•]/u.test(first)) return false;
  return /\p{Ll}/u.test(first);
}

function endsMidSentence(text: string): boolean {
  const last = text.trimEnd().at(-1);
  if (!last) return false;
  return !/[.!?…:;)"”»\]]/u.test(last) && !text.trimEnd().endsWith('|');
}

function noiseRatio(text: string): number {
  if (text.length === 0) return 1;
  const nonWord = (text.match(/[^\p{L}\p{N}\s.,;:!?()"'%\-/|]/gu) ?? []).length;
  return nonWord / text.length;
}
