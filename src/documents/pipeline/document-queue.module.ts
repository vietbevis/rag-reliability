import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { RagModule } from '../../rag/rag.module';
import { RagGraphModule } from '../../rag/graph/rag-graph.module';
import { DocumentPipelineService } from './document-pipeline.service';
import { DocumentQueueService } from './document-queue.service';
import { DocumentPipelineProcessor } from './document-pipeline.processor';
import { DOCUMENT_PIPELINE_QUEUE } from './pipeline.constants';

/**
 * `QUEUE_ENABLED` được đọc ở đây (lúc dựng cây module, sớm hơn ConfigModule) để
 * quyết định có nạp `BullModule` + worker hay không. `main.ts` đã `import
 * 'dotenv/config'` nên `.env` có mặt trong `process.env` tại thời điểm này.
 * Test set `process.env.QUEUE_ENABLED='false'` trong setup file.
 */
function queueEnabled(): boolean {
  const v = process.env.QUEUE_ENABLED;
  return v === undefined || v === 'true' || v === '1';
}

/**
 * Đăng ký pipeline xử lý tài liệu. Queue bật: thêm `BullModule` (kết nối Redis)
 * và worker `DocumentPipelineProcessor`. Queue tắt: chỉ có
 * {@link DocumentQueueService} chạy pipeline inline — không phụ thuộc Redis.
 */
@Module({})
export class DocumentQueueModule {
  static register(): DynamicModule {
    const enabled = queueEnabled();

    const imports: DynamicModule['imports'] = [RagModule, RagGraphModule];
    const providers: Provider[] = [
      DocumentPipelineService,
      DocumentQueueService,
    ];

    if (enabled) {
      imports.push(
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<AppConfig, true>) => {
            const q = config.get('queue', { infer: true });
            return {
              connection: {
                host: q.redis.host,
                port: q.redis.port,
                password: q.redis.password,
                db: q.redis.db,
              },
            };
          },
        }),
        BullModule.registerQueue({ name: DOCUMENT_PIPELINE_QUEUE }),
      );
      providers.push(DocumentPipelineProcessor);
    }

    return {
      module: DocumentQueueModule,
      imports,
      providers,
      exports: [DocumentQueueService, DocumentPipelineService],
    };
  }
}
