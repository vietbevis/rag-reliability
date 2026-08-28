import { Module } from '@nestjs/common';
import { AnydocParserService } from './parsers/anydoc-parser.service';
import { HtmlParserService } from './parsers/html-parser.service';
import { ParserFactoryService } from './parsers/parser-factory.service';
import { PlainTextParserService } from './parsers/plain-text-parser.service';

/**
 * Phạm vi PHASE 0: chỉ parsing tài liệu (anydoc + fallback). Ingestion,
 * cleaning, normalize, dedup và chấm điểm chất lượng thuộc PHASE 1; controller
 * upload sẽ đi kèm ở đó.
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
export class DocumentsModule {}
