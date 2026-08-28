import { Injectable, Logger } from '@nestjs/common';
import { ParserError } from '../../common/errors';
import type { ParsedDocument } from '../../common/types';
import { AnydocParserService } from './anydoc-parser.service';
import { HtmlParserService } from './html-parser.service';
import type { DocumentParser, ParserInput } from './parser.interface';
import { PlainTextParserService } from './plain-text-parser.service';

/**
 * Chọn parser theo MIME type (PROMPT §5.3):
 *
 *   anydoc hỗ trợ + khả dụng   ->  anydoc  (output Markdown)
 *   text/markdown, text/plain  ->  plaintext
 *   text/html                  ->  html
 *   còn lại                    ->  ParserError('UNSUPPORTED_MIME')
 *
 * `isAvailable()` là điểm phòng thủ chung cho mọi parser (vd một parser cần
 * service ngoài): nếu parser chính báo không khả dụng mà có fallback text khớp
 * thì dùng fallback. Lỗi anydoc lúc parse KHÔNG bị nuốt âm thầm — nó được ném
 * tiếp để pipeline ingestion đánh dấu document FAILED kèm lý do cụ thể.
 */
@Injectable()
export class ParserFactoryService {
  private readonly logger = new Logger(ParserFactoryService.name);
  private readonly fallbacks: DocumentParser[];

  constructor(
    private readonly anydoc: AnydocParserService,
    plainText: PlainTextParserService,
    html: HtmlParserService,
  ) {
    this.fallbacks = [plainText, html];
  }

  async resolve(mimeType: string): Promise<DocumentParser> {
    if (this.anydoc.supports(mimeType) && (await this.anydoc.isAvailable())) {
      return this.anydoc;
    }
    const fallback = this.fallbacks.find((p) => p.supports(mimeType));
    if (fallback) return fallback;

    if (this.anydoc.supports(mimeType)) {
      throw new ParserError(
        'PARSER_UNAVAILABLE',
        `Không có parser khả dụng cho ${mimeType} (anydoc báo không khả dụng và không có fallback text khớp)`,
        { mimeType },
      );
    }
    throw new ParserError(
      'UNSUPPORTED_MIME',
      `Loại tài liệu không được hỗ trợ: ${mimeType}`,
      { mimeType },
    );
  }

  async parse(input: ParserInput): Promise<ParsedDocument> {
    const parser = await this.resolve(input.mimeType);
    this.logger.debug(`Parsing ${input.mimeType} with ${parser.type}`);
    return parser.parse(input);
  }

  async describe(): Promise<{
    anydocAvailable: boolean;
    parsers: Array<{ type: string; mimeSupported: string }>;
  }> {
    return {
      anydocAvailable: await this.anydoc.isAvailable(),
      parsers: [
        {
          type: 'anydoc',
          mimeSupported: 'docx, pptx, xlsx, odt, rtf, epub, csv, pdf',
        },
        { type: 'plaintext', mimeSupported: 'text/plain, text/markdown' },
        { type: 'html', mimeSupported: 'text/html' },
      ],
    };
  }
}
