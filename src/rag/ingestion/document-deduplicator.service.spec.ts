import { PrismaService } from '../../database/prisma.service';
import { DocumentDeduplicatorService } from './document-deduplicator.service';

function makeService(overrides: {
  findMany?: jest.Mock;
  updateMany?: jest.Mock;
}): {
  svc: DocumentDeduplicatorService;
  findMany: jest.Mock;
  updateMany: jest.Mock;
} {
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([]);
  const updateMany =
    overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    document: { findMany, updateMany },
  } as unknown as PrismaService;
  return { svc: new DocumentDeduplicatorService(prisma), findMany, updateMany };
}

const NOW = Date.now();
const fresh = new Date(NOW - 60_000); // 1 phút trước
const stale = new Date(NOW - 60 * 60_000); // 1 giờ trước

describe('DocumentDeduplicatorService', () => {
  it('phát hiện trùng lặp EXACT với document COMPLETED', async () => {
    const { svc } = makeService({
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'doc-1', status: 'COMPLETED', updatedAt: stale },
        ]),
    });
    const r = await svc.check({
      checksum: 'abc',
      normalizedHash: 'xyz',
      excludeId: 'self',
    });
    expect(r).toEqual({
      isDuplicate: true,
      type: 'EXACT',
      duplicateOfId: 'doc-1',
      reclaimed: 0,
    });
  });

  it('document đang xử lý CÒN MỚI -> vẫn khoá là trùng lặp', async () => {
    const { svc } = makeService({
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'doc-1', status: 'EMBEDDING', updatedAt: fresh },
        ]),
    });
    const r = await svc.check({
      checksum: 'abc',
      normalizedHash: null,
      excludeId: 'self',
    });
    expect(r.isDuplicate).toBe(true);
    expect(r.duplicateOfId).toBe('doc-1');
  });

  it('document kẹt ở EMBEDDING QUÁ HẠN -> thu hồi về FAILED, KHÔNG chặn bản mới', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { svc, findMany } = makeService({
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'orphan-1', status: 'EMBEDDING', updatedAt: stale },
        ])
        .mockResolvedValueOnce([]),
      updateMany,
    });
    const r = await svc.check({
      checksum: 'abc',
      normalizedHash: 'xyz',
      excludeId: 'self',
    });
    expect(r.isDuplicate).toBe(false);
    expect(r.reclaimed).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['orphan-1'] } },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(findMany).toHaveBeenCalledTimes(2); // exact + near
  });

  it('không trùng lặp -> isDuplicate false, bỏ qua near khi hash null', async () => {
    const { svc, findMany } = makeService({
      findMany: jest.fn().mockResolvedValue([]),
    });
    const r = await svc.check({
      checksum: 'abc',
      normalizedHash: null,
      excludeId: 'self',
    });
    expect(r).toEqual({
      isDuplicate: false,
      type: null,
      duplicateOfId: null,
      reclaimed: 0,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('COMPLETED thắng dù có orphan cũ hơn đứng trước', async () => {
    const { svc } = makeService({
      findMany: jest.fn().mockResolvedValueOnce([
        { id: 'orphan', status: 'PARSING', updatedAt: stale },
        { id: 'done', status: 'COMPLETED', updatedAt: fresh },
      ]),
    });
    const r = await svc.check({
      checksum: 'abc',
      normalizedHash: null,
      excludeId: 'self',
    });
    // gặp orphan trước -> push vào staleOrphans, gặp COMPLETED -> block
    expect(r.isDuplicate).toBe(true);
    expect(r.duplicateOfId).toBe('done');
  });
});
