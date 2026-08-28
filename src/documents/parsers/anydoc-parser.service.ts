import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Format,
  formatFromBytes,
  formatFromExtension,
  formatFromPath,
  toMarkdownBytes,
} from '@firecrawl/anydoc';
import type { AppConfig } from '../../config/configuration';
import { ANYDOC_MIME_TYPES } from '../../common/constants';
import { ParserError } from '../../common/errors';
import type { ParsedDocument } from '../../common/types';
import type { DocumentParser, ParserInput } from './parser.interface';

/**
 * Parser chính: `@firecrawl/anydoc` (PROMPT §5). Chuyển
 * Office/OpenDocument/RTF/EPUB/CSV/PDF sang Markdown GitHub-flavored sạch, thứ
 * mà chunking theo cấu trúc (PHASE 2) dùng trực tiếp.
 *
 * Lỗi parse (needsOcr, encrypted, malformed…) được map sang `ParserError` có
 * code cụ thể; `ParserFactory` bắt lỗi này để fallback hoặc reject rõ ràng
 * (PROMPT §5.4, §54).
 */
@Injectable()
export class AnydocParserService implements DocumentParser {
  readonly type = 'anydoc' as const;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  supports(mimeType: string): boolean {
    return ANYDOC_MIME_TYPES.includes(
      mimeType.split(';')[0]?.trim() ?? mimeType,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async parse(input: ParserInput): Promise<ParsedDocument> {
    const parsing = this.config.get('parsing', { infer: true });

    // Ưu tiên nhận diện format từ nội dung; extension chỉ là fallback cho các
    // format không có chữ ký (CSV) hoặc container không nhận ra.
    const format: Format | null =
      formatFromBytes(input.bytes) ??
      (input.filename
        ? formatFromPath(input.filename)
        : formatFromExtension(mimeToExt(input.mimeType) ?? ''));

    try {
      const markdown = await toMarkdownBytes(input.bytes, format, {
        ocr: parsing.ocr,
        apiKey: parsing.firecrawlApiKey,
        apiUrl: parsing.firecrawlApiUrl,
      });
      const trimmed = markdown.trim();
      if (!trimmed) {
        throw new ParserError('EMPTY_OUTPUT', 'anydoc không tạo ra nội dung', {
          mimeType: input.mimeType,
        });
      }
      return {
        markdown: trimmed,
        text: trimmed,
        parser: 'anydoc',
        warnings: [],
        metadata: { detectedFormat: format ?? null },
      };
    } catch (err) {
      if (err instanceof ParserError) throw err;
      throw this.mapError(err, input.mimeType);
    }
  }

  private mapError(err: unknown, mimeType: string): ParserError {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    switch (code) {
      case 'needsOcr':
        return new ParserError(
          'NEEDS_OCR',
          `PDF cần OCR (đặt ANYDOC_OCR=hosted + FIRECRAWL_API_KEY): ${message}`,
          { mimeType, pages: (err as { pages?: number[] }).pages },
          { cause: err },
        );
      case 'encrypted':
        return new ParserError(
          'ENCRYPTED',
          message,
          { mimeType },
          { cause: err },
        );
      case 'malformed':
      case 'missingPart':
      case 'resourceLimit':
        return new ParserError(
          'MALFORMED',
          message,
          { mimeType },
          { cause: err },
        );
      case 'unsupported':
        return new ParserError(
          'UNSUPPORTED_MIME',
          message,
          { mimeType },
          { cause: err },
        );
      default:
        return new ParserError(
          'PARSE_FAILED',
          `anydoc thất bại: ${message}`,
          { mimeType, code },
          { cause: err },
        );
    }
  }
}

/** MIME type → phần mở rộng, để anydoc đoán format cho các định dạng không có chữ ký. */
function mimeToExt(mimeType: string): string | null {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.oasis.opendocument.presentation': 'odp',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/rtf': 'rtf',
    'text/rtf': 'rtf',
    'application/epub+zip': 'epub',
  };
  return map[mimeType.split(';')[0]?.trim() ?? mimeType] ?? null;
}
