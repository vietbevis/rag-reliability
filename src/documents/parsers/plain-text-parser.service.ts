import { Injectable } from '@nestjs/common';
import { PLAIN_TEXT_MIME_TYPES } from '../../common/constants';
import { ParserError } from '../../common/errors';
import type { ParsedDocument } from '../../common/types';
import type { DocumentParser, ParserInput } from './parser.interface';

/** Parser fallback cho `.txt` / `.md` (PROMPT §5.3). Markdown giữ nguyên. */
@Injectable()
export class PlainTextParserService implements DocumentParser {
  readonly type = 'plaintext' as const;

  supports(mimeType: string): boolean {
    return PLAIN_TEXT_MIME_TYPES.includes(
      mimeType.split(';')[0]?.trim() ?? mimeType,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async isAvailable(): Promise<boolean> {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async parse(input: ParserInput): Promise<ParsedDocument> {
    const text = new TextDecoder('utf-8', { fatal: false })
      .decode(input.bytes)
      .replace(/\r\n/g, '\n');
    if (!text.trim()) {
      throw new ParserError('EMPTY_OUTPUT', 'File không có nội dung text', {
        mimeType: input.mimeType,
      });
    }
    const isMarkdown = (input.mimeType.split(';')[0] ?? '').includes(
      'markdown',
    );
    return {
      markdown: isMarkdown ? text : '',
      text,
      parser: 'plaintext',
      warnings: isMarkdown
        ? []
        : ['Không có markup cấu trúc; xử lý như text phẳng'],
      metadata: {},
    };
  }
}
