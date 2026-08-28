import { PrismaService } from '../../database/prisma.service';
import { DocumentDeduplicatorService } from './document-deduplicator.service';

function makeService(findFirst: jest.Mock): DocumentDeduplicatorService {
  const prisma = {
    document: { findFirst },
  } as unknown as PrismaService;
  return new DocumentDeduplicatorService(prisma);
}

describe('DocumentDeduplicatorService', () => {
  it('phát hiện trùng lặp EXACT theo checksum', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'doc-1' });
    const r = await makeService(findFirst).check({
      checksum: 'abc',
      normalizedHash: 'xyz',
      excludeId: 'self',
    });
    expect(r).toEqual({
      isDuplicate: true,
      type: 'EXACT',
      duplicateOfId: 'doc-1',
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('phát hiện trùng lặp NEAR theo normalizedHash khi không exact', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'doc-2' });
    const r = await makeService(findFirst).check({
      checksum: 'abc',
      normalizedHash: 'xyz',
      excludeId: 'self',
    });
    expect(r.type).toBe('NEAR');
    expect(r.duplicateOfId).toBe('doc-2');
  });

  it('không trùng lặp -> isDuplicate false', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const r = await makeService(findFirst).check({
      checksum: 'abc',
      normalizedHash: null,
      excludeId: 'self',
    });
    expect(r).toEqual({ isDuplicate: false, type: null, duplicateOfId: null });
    expect(findFirst).toHaveBeenCalledTimes(1); // bỏ qua near khi hash null
  });
});
