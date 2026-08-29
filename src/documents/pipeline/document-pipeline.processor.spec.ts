import type { Job } from 'bullmq';
import { DocumentPipelineProcessor } from './document-pipeline.processor';
import { DocumentStatus } from '../../generated/prisma/client';
import { mockConfigService } from '../../config/config.mock';
import type { ProcessDocumentJobData } from './pipeline.constants';

const config = mockConfigService({ queue: { jobAttempts: 3 } });

const job = (
  over: Partial<Job<ProcessDocumentJobData>>,
): Job<ProcessDocumentJobData> =>
  ({
    id: 'doc1',
    attemptsMade: 0,
    data: { documentId: 'doc1', trigger: 'upload' },
    ...over,
  }) as Job<ProcessDocumentJobData>;

describe('DocumentPipelineProcessor', () => {
  const prisma = { document: { update: jest.fn() } };
  const pipeline = { run: jest.fn() };

  const make = () =>
    new DocumentPipelineProcessor(config, prisma as never, pipeline as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.document.update.mockResolvedValue({});
  });

  it('process gọi pipeline.run với documentId + trigger', async () => {
    pipeline.run.mockResolvedValue({ status: DocumentStatus.COMPLETED });
    const res = await make().process(job({}));
    expect(pipeline.run).toHaveBeenCalledWith('doc1', 'upload');
    expect(res).toEqual({ status: DocumentStatus.COMPLETED });
  });

  it('onFailed: còn lượt thử → KHÔNG đụng status', async () => {
    await make().onFailed(job({ attemptsMade: 1 }), new Error('x'));
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('onFailed: hết lượt thử → status FAILED', async () => {
    await make().onFailed(job({ attemptsMade: 3 }), new Error('x'));
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc1' },
      data: { status: DocumentStatus.FAILED },
    });
  });
});
