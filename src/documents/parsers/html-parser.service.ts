import { Injectable } from '@nestjs/common';
import { HTML_MIME_TYPES } from '../../common/constants';
import { ParserError } from '../../common/errors';
import type { ParsedDocument } from '../../common/types';
import type { DocumentParser, ParserInput } from './parser.interface';

/**
 * Parser fallback cho HTML (PROMPT §5.3). Không phụ thuộc thư viện: loại bỏ
 * script/style/thẻ, decode các entity phổ biến, gộp khoảng trắng. Đủ tốt để
 * làm fallback; nơi nào dùng được anydoc thì ưu tiên anydoc.
 */
@Injectable()
export class HtmlParserService implements DocumentParser {
  readonly type = 'html' as const;

  supports(mimeType: string): boolean {
    return HTML_MIME_TYPES.includes(mimeType.split(';')[0]?.trim() ?? mimeType);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async isAvailable(): Promise<boolean> {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async parse(input: ParserInput): Promise<ParsedDocument> {
    const html = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    const text = htmlToText(html);
    if (!text.trim()) {
      throw new ParserError('EMPTY_OUTPUT', 'HTML không có text đọc được', {
        mimeType: input.mimeType,
      });
    }
    return {
      markdown: '',
      text,
      parser: 'html',
      warnings: ['Parser fallback đã làm phẳng HTML thành text'],
      metadata: {},
    };
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
