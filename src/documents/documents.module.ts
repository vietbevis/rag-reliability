import { Module } from '@nestjs/common';
import { RagGraphModule } from '../rag/graph/rag-graph.module';
import { RagModule } from '../rag/rag.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ParsersModule } from './parsers/parsers.module';
import { DocumentQueueModule } from './pipeline/document-queue.module';

/**
 * Upload / CRUD tài liệu. Ingestion pipeline nằm ở {@link RagModule}; module
 * này nhận file, lưu bytes gốc, rồi đẩy việc xử lý cho `DocumentQueueModule`
 * (BullMQ worker khi QUEUE_ENABLED, inline khi tắt). PHASE 5: pipeline có thêm
 * bước GRAPHING khi bật Graph RAG.
 */
@Module({
  imports: [
    ParsersModule,
    RagModule,
    RagGraphModule,
    DocumentQueueModule.register(),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
