import { Module } from '@nestjs/common';
import { AnydocParserService } from './anydoc-parser.service';
import { HtmlParserService } from './html-parser.service';
import { ParserFactoryService } from './parser-factory.service';
import { PlainTextParserService } from './plain-text-parser.service';

/**
 * Các parser tài liệu (anydoc + fallback). Tách riêng để cả `DocumentsModule`
 * (upload) lẫn `RagModule` (ingestion) dùng chung mà không tạo phụ thuộc vòng.
 */
@Module({
  providers: [
    AnydocParserService,
    PlainTextParserService,
    HtmlParserService,
    ParserFactoryService,
  ],
  exports: [ParserFactoryService],
})
export class ParsersModule {}
