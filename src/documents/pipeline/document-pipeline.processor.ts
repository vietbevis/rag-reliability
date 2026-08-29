import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { DocumentStatus } from '../../generated/prisma/client';
import { DocumentPipelineService } from './document-pipeline.service';
import {
  DOCUMENT_PIPELINE_QUEUE,
  type ProcessDocumentJobData,
} from './pipeline.constants';

/**
 * Worker BullMQ: nhận job `process-document` và chạy
 * {@link DocumentPipelineService}. `concurrency` lấy từ `QUEUE_CONCURRENCY`
 * (mặc định 1 — LLM local phục vụ tuần tự). Job ném lỗi → BullMQ retry theo
 * `attempts`/`backoff`; hết lượt → {@link onFailed} đưa document về FAILED.
 */
@Processor(DOCUMENT_PIPELINE_QUEUE, {
  concurrency: Number(process.env.QUEUE_CONCURRENCY ?? 1),
})
export class DocumentPipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentPipelineProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly pipeline: DocumentPipelineService,
  ) {
    super();
    this.maxAttempts = config.get('queue', { infer: true }).jobAttempts;
  }

  async process(job: Job<ProcessDocumentJobData>): Promise<{ status: string }> {
    const { documentId, trigger } = job.data;
    this.logger.log(
      `Job ${job.id} chạy document ${documentId} ` +
        `(lần ${job.attemptsMade + 1}/${this.maxAttempts}, trigger=${trigger})`,
    );
    const result = await this.pipeline.run(documentId, trigger);
    return { status: result.status };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessDocumentJobData>, err: Error): Promise<void> {
    const isLast = job.attemptsMade >= this.maxAttempts;
    this.logger.error(
      `Job ${job.id} lỗi (lần ${job.attemptsMade}/${this.maxAttempts})` +
        `${isLast ? ' — hết lượt thử' : ' — sẽ thử lại'}: ${err.message}`,
    );
    if (!isLast) return;
    await this.prisma.document
      .update({
        where: { id: job.data.documentId },
        data: { status: DocumentStatus.FAILED },
      })
      .catch(() => undefined);
  }
}
