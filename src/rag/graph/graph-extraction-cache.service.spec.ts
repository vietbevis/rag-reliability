import { PrismaService } from '../../database/prisma.service';
import { GraphExtractionCacheService } from './graph-extraction-cache.service';

function build(row: unknown = null) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    graphExtractionCache: { findUnique, upsert },
  } as unknown as PrismaService;
  return {
    svc: new GraphExtractionCacheService(prisma),
    findUnique,
    upsert,
  };
}

describe('GraphExtractionCacheService', () => {
  it('hash tất định theo nội dung', () => {
    const { svc } = build();
    expect(svc.hash('abc')).toBe(svc.hash('abc'));
    expect(svc.hash('abc')).not.toBe(svc.hash('abd'));
  });

  it('miss → null', async () => {
    const { svc } = build(null);
    expect(await svc.get('h', 'm', '1')).toBeNull();
  });

  it('hit → validate qua Zod, kèm token', async () => {
    const { svc } = build({
      entities: [{ name: 'A', type: 'ORG', description: '' }],
      relationships: [],
      inputTokens: 10,
      outputTokens: 5,
    });
    const got = await svc.get('h', 'm', '1');
    expect(got).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(got!.entities[0]!.name).toBe('A');
  });

  it('hit nhưng dữ liệu hỏng schema → null (không nổ)', async () => {
    const { svc } = build({
      entities: [{ type: 'ORG' }], // thiếu name
      relationships: [],
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(await svc.get('h', 'm', '1')).toBeNull();
  });

  it('put → upsert theo khoá 3 phần', async () => {
    const { svc, upsert } = build();
    await svc.put('h1', 'gpt', '2', {
      entities: [],
      relationships: [],
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chunkHash_model_promptVersion: {
            chunkHash: 'h1',
            model: 'gpt',
            promptVersion: '2',
          },
        },
      }),
    );
  });
});
