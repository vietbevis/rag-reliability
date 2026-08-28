import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { QualityIssue, QualityReport } from '../../common/types';

export interface QualityInput {
  /** Text đã clean. */
  text: string;
  title?: string;
  source?: string;
  tokenCount?: number;
}

interface Rule {
  type: string;
  severity: QualityIssue['severity'];
  /** Trọng số phạt điểm khi rule kích hoạt (0..1). */
  penalty: number;
  /** Rule ERROR làm `valid=false` ngay lập tức. */
  check: (input: QualityInput, stats: TextStats) => string | null;
}

interface TextStats {
  chars: number;
  words: number;
  lines: number;
  alphaRatio: number;
  symbolRatio: number;
  replacementChars: number;
  internalRepetitionRatio: number;
}

/**
 * Chấm điểm chất lượng tài liệu (PROMPT §10). Trả về `{ score, valid, issues }`.
 * `valid = score >= QUALITY_THRESHOLD` **và** không có issue mức ERROR.
 * Document không hợp lệ sẽ bị REJECT (không embedding — PROMPT §8).
 */
@Injectable()
export class DocumentQualityService {
  private readonly threshold: number;
  private readonly minChars = 40;
  private readonly shortChars = 200;

  constructor(config: ConfigService<AppConfig, true>) {
    this.threshold = config.get('rag', { infer: true }).qualityThreshold;
  }

  private readonly rules: Rule[] = [
    {
      type: 'EMPTY_DOCUMENT',
      severity: 'ERROR',
      penalty: 1,
      check: (_i, s) =>
        s.chars === 0 ? 'Tài liệu rỗng sau khi làm sạch' : null,
    },
    {
      type: 'TOO_SHORT',
      severity: 'ERROR',
      penalty: 0.6,
      check: (_i, s) =>
        s.chars > 0 && s.chars < this.minChars
          ? `Quá ngắn (${s.chars} ký tự, tối thiểu ${this.minChars})`
          : null,
    },
    {
      type: 'SHORT_DOCUMENT',
      severity: 'WARNING',
      penalty: 0.15,
      check: (_i, s) =>
        s.chars >= this.minChars && s.chars < this.shortChars
          ? `Tài liệu ngắn (${s.chars} ký tự)`
          : null,
    },
    {
      type: 'BROKEN_ENCODING',
      severity: 'ERROR',
      penalty: 0.7,
      check: (_i, s) =>
        s.replacementChars > 0
          ? `Có ${s.replacementChars} ký tự thay thế (U+FFFD) — hỏng mã hoá`
          : null,
    },
    {
      type: 'OCR_NOISE',
      severity: 'WARNING',
      penalty: 0.35,
      check: (_i, s) =>
        s.chars > 0 && s.alphaRatio < 0.5
          ? `Tỉ lệ chữ cái thấp (${(s.alphaRatio * 100).toFixed(0)}%) — có thể nhiễu OCR`
          : null,
    },
    {
      type: 'EXCESSIVE_SYMBOLS',
      severity: 'WARNING',
      penalty: 0.3,
      check: (_i, s) =>
        s.symbolRatio > 0.3
          ? `Quá nhiều ký hiệu (${(s.symbolRatio * 100).toFixed(0)}%)`
          : null,
    },
    {
      type: 'DUPLICATE_CONTENT',
      severity: 'WARNING',
      penalty: 0.25,
      check: (_i, s) =>
        s.internalRepetitionRatio > 0.65
          ? `Lặp nội dung nội bộ cao (${(s.internalRepetitionRatio * 100).toFixed(0)}%)`
          : null,
    },
    {
      type: 'MISSING_METADATA',
      severity: 'WARNING',
      penalty: 0.1,
      check: (i) =>
        !i.title?.trim() || !i.source?.trim()
          ? 'Thiếu title hoặc source'
          : null,
    },
  ];

  assess(input: QualityInput): QualityReport {
    const stats = this.computeStats(input.text);
    const issues: QualityIssue[] = [];
    let score = 1;
    let blocked = false;

    for (const rule of this.rules) {
      const message = rule.check(input, stats);
      if (!message) continue;
      issues.push({ type: rule.type, severity: rule.severity, message });
      score -= rule.penalty;
      if (rule.severity === 'ERROR') blocked = true;
    }

    score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
    const valid = !blocked && score >= this.threshold;
    return { score, valid, issues };
  }

  private computeStats(text: string): TextStats {
    const chars = text.length;
    if (chars === 0) {
      return {
        chars: 0,
        words: 0,
        lines: 0,
        alphaRatio: 0,
        symbolRatio: 0,
        replacementChars: 0,
        internalRepetitionRatio: 0,
      };
    }
    const alpha = (text.match(/\p{L}/gu) ?? []).length;
    const digits = (text.match(/\p{N}/gu) ?? []).length;
    const spaces = (text.match(/\s/g) ?? []).length;
    const symbols = chars - alpha - digits - spaces;
    const words = text.split(/\s+/).filter(Boolean);
    const replacementChars = (text.match(/�/g) ?? []).length;

    return {
      chars,
      words: words.length,
      lines: text.split('\n').length,
      alphaRatio: alpha / chars,
      symbolRatio: symbols / chars,
      replacementChars,
      internalRepetitionRatio: this.repetitionRatio(words),
    };
  }

  /** Tỉ lệ 1 - (số 8-gram từ duy nhất / tổng số 8-gram). Cao = lặp nhiều. */
  private repetitionRatio(words: string[]): number {
    const n = 8;
    if (words.length < n * 4) return 0;
    const grams = new Set<string>();
    let total = 0;
    for (let i = 0; i + n <= words.length; i++) {
      grams.add(
        words
          .slice(i, i + n)
          .join(' ')
          .toLowerCase(),
      );
      total++;
    }
    return total === 0 ? 0 : 1 - grams.size / total;
  }
}
