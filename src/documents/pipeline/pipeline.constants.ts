/** Tên queue BullMQ cho pipeline xử lý tài liệu. */
export const DOCUMENT_PIPELINE_QUEUE = 'document-pipeline';

/** Tên job (một loại job duy nhất: chạy toàn bộ pipeline cho 1 document). */
export const PROCESS_DOCUMENT_JOB = 'process-document';

/** Lý do một job được đẩy vào queue — ghi vào log & metadata job. */
export type PipelineTrigger = 'upload' | 'reingest' | 'graph';

/** Payload của job {@link PROCESS_DOCUMENT_JOB}. */
export interface ProcessDocumentJobData {
  documentId: string;
  trigger: PipelineTrigger;
}
