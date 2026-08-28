import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../src/config/configuration';
import { loadConfiguration } from '../src/config/configuration';
import { PrismaService } from '../src/database/prisma.service';

/**
 * Integration: Prisma 7 + driver adapter `@prisma/adapter-pg` + pgvector.
 * Cần PostgreSQL đang chạy và migration đã áp (npm run prisma:migrate).
 */
describe('PrismaService (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const config = loadConfiguration();
    prisma = new PrismaService({
      get: () => config.database,
    } as unknown as ConfigService<AppConfig, true>);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('kết nối được và chạy raw query', async () => {
    await expect(prisma.ping()).resolves.toBeUndefined();
  });

  it('extension pgvector đã được cài', async () => {
    await expect(prisma.isVectorExtensionInstalled()).resolves.toBe(true);
  });

  it('CRUD round-trip trên EvaluationDataset', async () => {
    const name = `it-${Date.now()}`;
    const created = await prisma.evaluationDataset.create({ data: { name } });
    expect(created.version).toBe('1');

    const found = await prisma.evaluationDataset.findUnique({
      where: { name },
    });
    expect(found?.id).toBe(created.id);

    await prisma.evaluationDataset.delete({ where: { id: created.id } });
    const gone = await prisma.evaluationDataset.findUnique({ where: { name } });
    expect(gone).toBeNull();
  });

  it('ghi và đọc lại được cột vector qua raw SQL', async () => {
    const doc = await prisma.document.create({
      data: {
        title: 't',
        source: 's',
        mimeType: 'text/plain',
        checksum: `c-${Date.now()}`,
      },
    });
    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: doc.id,
        content: 'x',
        contentHash: 'h',
        sequence: 0,
        tokenCount: 1,
      },
    });
    const id = `emb-${Date.now()}`;
    await prisma.$executeRaw`
      INSERT INTO "Embedding" ("id","chunkId","provider","model","dimensions","embedding")
      VALUES (${id}, ${chunk.id}, 'test', 'test', 3, ${'[0.1,0.2,0.3]'}::vector)
    `;
    const rows = await prisma.$queryRaw<Array<{ d: number }>>`
      SELECT "embedding" <-> '[0,0,0]'::vector AS d FROM "Embedding" WHERE "id" = ${id}
    `;
    expect(rows[0]?.d).toBeGreaterThan(0);

    await prisma.document.delete({ where: { id: doc.id } });
  });
});
