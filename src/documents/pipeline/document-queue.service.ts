import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { DocumentStatus } from '../../generated/prisma/client';
import { DocumentPipelineService } from './document-pipeline.service';
import {
  DOCUMENT_PIPELINE_QUEUE,
  PROCESS_DOCUMENT_JOB,
  type PipelineTrigger,
  type ProcessDocumentJobData,
} from './pipeline.constants';

export interface EnqueueResult {
  /** id job BullMQ (= documentId). `null` khi queue tắt (đã chạy inline). */
  jobId: string | null;
  /** Trạng thái tài liệu ngay sau khi enqueue (QUEUED) hoặc sau khi chạy inline. */
  status: DocumentStatus;
  /** true nếu pipeline đã chạy xong đồng bộ (queue tắt). */
  ranInline: boolean;
}

export interface JobStateView {
  jobId: string;
  state: string;
  attemptsMade: number;
  failedReason: string | null;
}

/**
 * Điểm vào duy nhất để "xử lý một tài liệu". Queue bật (mặc định): đẩy job vào
 * BullMQ, trả ngay, worker chạy nền. Queue tắt (test/CI/không Redis): chạy
 * {@link DocumentPipelineService} inline và chờ xong.
 */
@Injectable()
export class DocumentQueueService {
  private readonly logger = new Logger(DocumentQueueService.name);
  private readonly cfg: AppConfig['queue'];

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly pipeline: DocumentPipelineService,
    @Optional()
    @InjectQueue(DOCUMENT_PIPELINE_QUEUE)
    private readonly queue?: Queue<ProcessDocumentJobData>,
  ) {
    this.cfg = config.get('queue', { infer: true });
  }

  get enabled(): boolean {
    return this.cfg.enabled && !!this.queue;
  }

  /** Đẩy tài liệu vào pipeline. `documentId` phải trỏ tới document đã tồn tại. */
  async enqueue(
    documentId: string,
    trigger: PipelineTrigger,
  ): Promise<EnqueueResult> {
    if (!this.enabled) {
      const result = await this.pipeline.run(documentId, trigger);
      return { jobId: null, status: result.status, ranInline: true };
    }

    const queue = this.queue!;
    // trigger='graph' chỉ dựng lại graph trên document đã COMPLETED — KHÔNG hạ
    // status về QUEUED (pipeline yêu cầu COMPLETED/GRAPHING để dựng graph).
    const setQueued = trigger !== 'graph';

    // jobId = documentId: một tài liệu chỉ có tối đa một job đang chờ/chạy. Job
    // cũ đã completed/failed thì xoá để lần trigger mới (reingest/graph) chạy lại.
    const existing = await queue.getJob(documentId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        this.logger.log(
          `Document ${documentId} đã có job ở trạng thái ${state} — bỏ qua enqueue`,
        );
        if (setQueued) await this.markQueued(documentId);
        const status = setQueued
          ? DocumentStatus.QUEUED
          : await this.currentStatus(documentId);
        return { jobId: documentId, status, ranInline: false };
      }
    }

    if (setQueued) await this.markQueued(documentId);
    const status = setQueued
      ? DocumentStatus.QUEUED
      : await this.currentStatus(documentId);
    await queue.add(
      PROCESS_DOCUMENT_JOB,
      { documentId, trigger },
      {
        jobId: documentId,
        attempts: this.cfg.jobAttempts,
        backoff: { type: 'exponential', delay: this.cfg.jobBackoffMs },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    this.logger.log(
      `Document ${documentId} đã đẩy vào queue (trigger=${trigger})`,
    );
    return { jobId: documentId, status, ranInline: false };
  }

  /** Trạng thái job BullMQ của một tài liệu (null khi queue tắt hoặc không có job). */
  async jobState(documentId: string): Promise<JobStateView | null> {
    if (!this.enabled) return null;
    const job = await this.queue!.getJob(documentId);
    if (!job) return null;
    return {
      jobId: job.id ?? documentId,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
    };
  }

  private async markQueued(documentId: string): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.QUEUED },
    });
  }

  private async currentStatus(documentId: string): Promise<DocumentStatus> {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { status: true },
    });
    return doc.status;
  }
}
