import { Injectable } from '@nestjs/common';

export interface CleaningOptions {
  /** Output đến từ anydoc (Markdown) — giữ heading/list/code fence/table. */
  isMarkdown: boolean;
}

export interface CleaningResult {
  text: string;
  /** Tên phép biến đổi + số lần áp, để trace (PROMPT §9). */
  transformations: Array<{ name: string; count: number }>;
}

const PAGE_NUMBER_LINE =
  /^\s*(?:-\s*)?(?:trang|page|p\.)?\s*\d+\s*(?:\/\s*\d+|of\s+\d+|-|—)?\s*$/i;

/**
 * Làm sạch văn bản đã chuẩn hoá (PROMPT §9). KHÔNG sửa dữ liệu quan trọng một
 * cách âm thầm — mỗi phép biến đổi được đếm và trả về trong `transformations`.
 * Với Markdown thì bảo toàn heading / list / code fence / bảng.
 */
@Injectable()
export class DocumentCleanerService {
  clean(input: string, options: CleaningOptions): CleaningResult {
    const transformations: Array<{ name: string; count: number }> = [];
    let text = input;

    const apply = (
      name: string,
      fn: (t: string) => { text: string; count: number },
    ): void => {
      const { text: next, count } = fn(text);
      if (count > 0) {
        transformations.push({ name, count });
        text = next;
      }
    };

    apply('remove:page-numbers', (t) => this.removePageNumbers(t));
    apply('remove:repeated-headers-footers', (t) =>
      this.removeRepeatedBoilerplate(t),
    );
    apply('fix:hyphenated-linebreaks', (t) => this.joinHyphenatedWords(t));
    if (!options.isMarkdown) {
      apply('fix:broken-lines', (t) => this.joinBrokenLines(t));
    }
    apply('remove:ocr-artifact-lines', (t) => this.removeOcrArtifactLines(t));
    apply('remove:duplicate-paragraphs', (t) => this.dedupeParagraphs(t));
    apply('remove:markdown-noise', (t) => this.stripMarkdownNoise(t));
    apply('whitespace:collapse-spaces', (t) => ({
      text: t.replace(/[ \t]{2,}/g, ' '),
      count: (t.match(/[ \t]{2,}/g) ?? []).length,
    }));
    apply('whitespace:blank-lines', (t) => ({
      text: t.replace(/\n{3,}/g, '\n\n'),
      count: (t.match(/\n{3,}/g) ?? []).length,
    }));

    return { text: text.trim(), transformations };
  }

  /** Dòng chỉ chứa số trang ("12", "- 3 -", "Trang 4/10", "Page 2 of 9"). */
  private removePageNumbers(text: string): { text: string; count: number } {
    const lines = text.split('\n');
    let count = 0;
    const kept = lines.filter((line) => {
      if (PAGE_NUMBER_LINE.test(line) && line.trim() !== '') {
        count++;
        return false;
      }
      return true;
    });
    return { text: kept.join('\n'), count };
  }

  /**
   * Header/footer lặp lại: dòng ngắn (< 80 ký tự), không rỗng, không phải
   * heading Markdown, xuất hiện >= 3 lần -> xoá hết trừ lần đầu.
   */
  private removeRepeatedBoilerplate(text: string): {
    text: string;
    count: number;
  } {
    const lines = text.split('\n');
    const freq = new Map<string, number>();
    for (const line of lines) {
      const key = line.trim();
      if (key.length === 0 || key.length > 80 || key.startsWith('#')) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const boilerplate = new Set(
      [...freq.entries()].filter(([, c]) => c >= 3).map(([k]) => k),
    );
    if (boilerplate.size === 0) return { text, count: 0 };

    let count = 0;
    const seen = new Set<string>();
    const kept = lines.filter((line) => {
      const key = line.trim();
      if (!boilerplate.has(key)) return true;
      if (seen.has(key)) {
        count++;
        return false;
      }
      seen.add(key);
      return true;
    });
    return { text: kept.join('\n'), count };
  }

  /** Nối từ bị ngắt bởi dấu gạch nối cuối dòng ("thông-\ntin" -> "thôngtin"). */
  private joinHyphenatedWords(text: string): { text: string; count: number } {
    const re = /(\p{L})-\n(\p{L})/gu;
    const count = (text.match(re) ?? []).length;
    return { text: text.replace(re, '$1$2'), count };
  }

  /**
   * Nối dòng bị ngắt giữa câu (chỉ cho text thô): một `\n` đơn giữa hai dòng
   * đều kết thúc/bắt đầu bằng chữ thường -> nối bằng space.
   */
  private joinBrokenLines(text: string): { text: string; count: number } {
    const re = /(\p{Ll},?)\n(\p{Ll})/gu;
    const count = (text.match(re) ?? []).length;
    return { text: text.replace(re, '$1 $2'), count };
  }

  /**
   * Dòng nhiễu OCR: tỉ lệ ký tự không phải chữ/số/khoảng trắng > 40% và dòng
   * có ít nhất 4 ký tự (bỏ qua dòng ngắn và separator Markdown `---`, `***`).
   */
  private removeOcrArtifactLines(text: string): {
    text: string;
    count: number;
  } {
    const lines = text.split('\n');
    let count = 0;
    const kept = lines.filter((line) => {
      const t = line.trim();
      if (t.length < 4) return true;
      if (/^([-*_=])\1{2,}$/.test(t)) return true; // separator
      if (/^[|>#\-*+\d.)\s]+$/.test(t)) return true; // markdown table/list scaffold
      const nonWord = (t.match(/[^\p{L}\p{N}\s]/gu) ?? []).length;
      if (nonWord / t.length > 0.4) {
        count++;
        return false;
      }
      return true;
    });
    return { text: kept.join('\n'), count };
  }

  /** Đoạn văn (block ngăn bởi dòng trống) trùng lặp liên tiếp -> giữ 1. */
  private dedupeParagraphs(text: string): { text: string; count: number } {
    const paragraphs = text.split(/\n{2,}/);
    let count = 0;
    const kept: string[] = [];
    let prev = '';
    for (const p of paragraphs) {
      const norm = p.trim().replace(/\s+/g, ' ');
      if (norm.length > 0 && norm === prev) {
        count++;
        continue;
      }
      kept.push(p);
      prev = norm;
    }
    return { text: kept.join('\n\n'), count };
  }

  /** Nhiễu Markdown: HTML comment sót lại, link rỗng `[]()`, escape thừa `\`. */
  private stripMarkdownNoise(text: string): { text: string; count: number } {
    let count = 0;
    let out = text;

    const remove = (re: RegExp): void => {
      const matches = out.match(re);
      if (matches) {
        count += matches.length;
        out = out.replace(re, '');
      }
    };

    remove(/<!--[\s\S]*?-->/g);
    remove(/\[\]\(\s*\)/g);

    // Bỏ backslash-escape thừa: `\_` -> `_`, `\*` -> `*`, ...
    const escaped = /\\([_*[\]()#+\-.!`])/g;
    const escapedMatches = out.match(escaped);
    if (escapedMatches) {
      count += escapedMatches.length;
      out = out.replace(escaped, '$1');
    }

    return { text: out, count };
  }
}
