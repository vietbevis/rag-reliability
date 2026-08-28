import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ParsersModule } from './parsers/parsers.module';

/**
 * Upload / CRUD tài liệu. Ingestion pipeline nằm ở {@link RagModule}; module
 * này chỉ nhận file, lưu bytes gốc, và gọi ingestion.
 */
@Module({
  imports: [ParsersModule, RagModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
