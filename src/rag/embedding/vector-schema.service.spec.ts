import { Logger } from '@nestjs/common';
import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { VectorSchemaService } from './vector-schema.service';

function make(
  queryRaw: jest.Mock,
  cfg: { dimension?: number; distance?: 'cosine' | 'l2' | 'ip' } = {},
): VectorSchemaService {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new VectorSchemaService(
    mockConfigService({ embedding: { ...cfg } }),
    prisma,
  );
}

describe('VectorSchemaService', () => {
  describe('getColumnDimension', () => {
    it('trả về số chiều khi atttypmod >= 0', async () => {
      const svc = make(jest.fn().mockResolvedValue([{ dim: 1536 }]));
      await expect(svc.getColumnDimension()).resolves.toBe(1536);
    });

    it('trả về null khi atttypmod < 0 (chưa khai báo số chiều)', async () => {
      const svc = make(jest.fn().mockResolvedValue([{ dim: -1 }]));
      await expect(svc.getColumnDimension()).resolves.toBeNull();
    });

    it('trả về null khi không tìm thấy cột', async () => {
      const svc = make(jest.fn().mockResolvedValue([]));
      await expect(svc.getColumnDimension()).resolves.toBeNull();
    });
  });

  describe('getIndexOps', () => {
    it('ánh xạ các hàng thành mảng opcname', async () => {
      const svc = make(
        jest
          .fn()
          .mockResolvedValue([
            { opcname: 'vector_cosine_ops' },
            { opcname: 'vector_l2_ops' },
          ]),
      );
      await expect(svc.getIndexOps()).resolves.toEqual([
        'vector_cosine_ops',
        'vector_l2_ops',
      ]);
    });

    it('mảng rỗng khi chưa có index', async () => {
      const svc = make(jest.fn().mockResolvedValue([]));
      await expect(svc.getIndexOps()).resolves.toEqual([]);
    });
  });

  describe('distanceOperator', () => {
    it.each([
      ['cosine', '<=>'],
      ['l2', '<->'],
      ['ip', '<#>'],
    ] as const)('%s -> %s', (distance, op) => {
      expect(make(jest.fn(), { distance }).distanceOperator).toBe(op);
    });
  });

  describe('onModuleInit', () => {
    it('cảnh báo khi EMBEDDING_DIMENSION khác số chiều cột', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ dim: 768 }]) // getColumnDimension
        .mockResolvedValueOnce([{ opcname: 'vector_cosine_ops' }]); // getIndexOps
      await make(queryRaw, { dimension: 1536 }).onModuleInit();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('EMBEDDING_DIMENSION=1536'),
      );
      warn.mockRestore();
    });

    it('cảnh báo khi chưa có ANN index', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ dim: 1536 }])
        .mockResolvedValueOnce([]); // không có index
      await make(queryRaw, { dimension: 1536 }).onModuleInit();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Chưa có ANN index'),
      );
      warn.mockRestore();
    });

    it('không throw khi query lỗi, chỉ log cảnh báo', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(
        make(queryRaw, { dimension: 1536 }).onModuleInit(),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Không kiểm tra được schema vector'),
      );
      warn.mockRestore();
    });

    it('im lặng khi mọi thứ khớp', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ dim: 1536 }])
        .mockResolvedValueOnce([{ opcname: 'vector_cosine_ops' }]);
      await make(queryRaw, {
        dimension: 1536,
        distance: 'cosine',
      }).onModuleInit();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
