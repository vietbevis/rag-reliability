import { DocumentQueueService } from './document-queue.service';
import { DocumentStatus } from '../../generated/prisma/client';
import { mockConfigService } from '../../config/config.mock';

const makeConfig = (queue: Record<string, unknown>) =>
  mockConfigService({ queue: queue });

describe('DocumentQueueService', () => {
  const pipeline = { run: jest.fn() };
  const prisma = {
    document: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pipeline.run.mockResolvedValue({ status: DocumentStatus.COMPLETED });
    prisma.document.update.mockResolvedValue({});
    prisma.document.findUniqueOrThrow.mockResolvedValue({
      status: DocumentStatus.COMPLETED,
    });
  });

  const baseCfg = {
    enabled: true,
    jobAttempts: 3,
    jobBackoffMs: 5000,
    concurrency: 1,
    redis: { host: 'h', port: 1, db: 0 },
  };

  describe('queue tắt (không có Queue instance)', () => {
    const svc = () =>
      new DocumentQueueService(
        makeConfig({ ...baseCfg, enabled: false }),
        prisma as never,
        pipeline as never,
        undefined,
      );

    it('enabled = false', () => {
      expect(svc().enabled).toBe(false);
    });

    it('enqueue chạy pipeline inline và trả status cuối', async () => {
      const res = await svc().enqueue('doc1', 'upload');
      expect(pipeline.run).toHaveBeenCalledWith('doc1', 'upload');
      expect(res).toEqual({
        jobId: null,
        status: DocumentStatus.COMPLETED,
        ranInline: true,
      });
    });

    it('jobState trả null khi queue tắt', async () => {
      await expect(svc().jobState('doc1')).resolves.toBeNull();
    });
  });

  describe('queue bật (có Queue)', () => {
    const queue = {
      getJob: jest.fn(),
      add: jest.fn(),
    };
    const svc = () =>
      new DocumentQueueService(
        makeConfig(baseCfg),
        prisma as never,
        pipeline as never,
        queue as never,
      );

    beforeEach(() => {
      queue.getJob.mockReset().mockResolvedValue(null);
      queue.add.mockReset().mockResolvedValue({});
    });

    it('enqueue set status QUEUED, add job với jobId=documentId, KHÔNG chạy inline', async () => {
      const res = await svc().enqueue('doc1', 'upload');
      expect(pipeline.run).not.toHaveBeenCalled();
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc1' },
        data: { status: DocumentStatus.QUEUED },
      });
      expect(queue.add).toHaveBeenCalledWith(
        'process-document',
        { documentId: 'doc1', trigger: 'upload' },
        expect.objectContaining({ jobId: 'doc1', attempts: 3 }),
      );
      expect(res).toEqual({
        jobId: 'doc1',
        status: DocumentStatus.QUEUED,
        ranInline: false,
      });
    });

    it('job cũ completed → xoá rồi add lại (reingest)', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      queue.getJob.mockResolvedValue({
        getState: () => Promise.resolve('completed'),
        remove,
      });
      await svc().enqueue('doc1', 'reingest');
      expect(remove).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });

    it("trigger='graph' KHÔNG hạ status về QUEUED (giữ COMPLETED)", async () => {
      const res = await svc().enqueue('doc1', 'graph');
      expect(prisma.document.update).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'process-document',
        { documentId: 'doc1', trigger: 'graph' },
        expect.objectContaining({ jobId: 'doc1' }),
      );
      expect(res.status).toBe(DocumentStatus.COMPLETED);
    });

    it('job đang active → không add trùng', async () => {
      queue.getJob.mockResolvedValue({
        getState: () => Promise.resolve('active'),
        remove: jest.fn(),
      });
      const res = await svc().enqueue('doc1', 'reingest');
      expect(queue.add).not.toHaveBeenCalled();
      expect(res.status).toBe(DocumentStatus.QUEUED);
    });

    it('jobState đọc trạng thái job BullMQ', async () => {
      queue.getJob.mockResolvedValue({
        id: 'doc1',
        attemptsMade: 2,
        failedReason: 'boom',
        getState: () => Promise.resolve('failed'),
      });
      await expect(svc().jobState('doc1')).resolves.toEqual({
        jobId: 'doc1',
        state: 'failed',
        attemptsMade: 2,
        failedReason: 'boom',
      });
    });
  });
});
