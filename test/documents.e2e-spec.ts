import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * E2E PHASE 1-3: upload -> ingest -> chunk -> embedding (pgvector) -> CRUD.
 * Cần PostgreSQL + pgvector + migration đã áp. Setup ép EMBEDDING_PROVIDER=fake
 * (tất định) để chạy được tới COMPLETED mà không cần API key.
 */
describe('Documents pipeline (e2e) — PHASE 1-3', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.document.deleteMany({ where: { id: { in: created } } });
    }
    await app.close();
  });

  const goodMarkdown = `# Quy chế đào tạo\n\n${Array.from(
    { length: 30 },
    (_, i) =>
      `Điều ${i + 1}. Sinh viên phải hoàn thành học phần theo kế hoạch của nhà trường.`,
  ).join('\n\n')}\n`;

  it('POST /documents (text) -> ingest + chunk + embedding, status COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'Quy chế', source: 'test', text: goodMarkdown });
    expect(res.status).toBe(201);
    created.push(res.body.document.id);

    expect(res.body.ingestion.status).toBe('VALIDATING');
    expect(res.body.document.status).toBe('COMPLETED'); // đã đi hết pipeline
    expect(res.body.document.parserUsed).toBe('PLAINTEXT');
    expect(res.body.document.qualityScore).toBeGreaterThan(0.7);
    expect(res.body.document.checksum).toHaveLength(64);
    expect(res.body.chunking.chunkCount).toBeGreaterThan(0);
    expect(res.body.chunking.strategy).toBe('structure');

    expect(res.body.embedding).toBeDefined();
    expect(res.body.embedding.skipped).toBe(false);
    expect(res.body.embedding.provider).toBe('fake');
    expect(res.body.embedding.model).toBe('fake-deterministic-v1');
    expect(res.body.embedding.dimensions).toBe(1536);
    expect(res.body.embedding.embeddedChunks).toBe(
      res.body.chunking.chunkCount,
    );
    expect(res.body.embedding.usage.inputTokens).toBeGreaterThan(0);

    expect(
      res.body.ingestion.stages.map((s: { stage: string }) => s.stage),
    ).toEqual(
      expect.arrayContaining([
        'PARSE',
        'NORMALIZE',
        'CLEAN',
        'DEDUPLICATE',
        'QUALITY',
      ]),
    );
  });

  it('GET /documents/:id trả về document đã cleaned', async () => {
    const id = created[0];
    const res = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.cleanedText).toContain('Quy chế đào tạo');
    expect(Array.isArray(res.body.transformations)).toBe(true);
  });

  it('GET /documents/:id/jobs liệt kê stage CHUNK và EMBED', async () => {
    const res = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/jobs`,
    );
    expect(res.status).toBe(200);
    const stages = res.body.map((j: { stage: string }) => j.stage);
    expect(stages).toContain('CHUNK');
    expect(stages).toContain('EMBED');
    expect(
      res.body.every((j: { status: string }) => j.status === 'COMPLETED'),
    ).toBe(true);
  });

  it('GET /documents/:id/chunks trả về chunk có heading/section/quality', async () => {
    const res = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/chunks`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    const c = res.body.items[0];
    expect(c.sequence).toBe(0);
    expect(c.tokenCount).toBeGreaterThan(0);
    expect(c.contentHash).toHaveLength(64);
    expect(typeof c.qualityScore).toBe('number');
    expect(c.metadata.strategy).toBe('structure');
  });

  it('GET /documents/:id/embeddings tóm tắt theo provider/model', async () => {
    const res = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/embeddings`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.byModel).toEqual([
      expect.objectContaining({
        provider: 'fake',
        model: 'fake-deterministic-v1',
        dimensions: 1536,
        count: res.body.total,
      }),
    ]);
  });

  it('POST /documents/:id/embed chạy lại embedding; vector có đúng số chiều trong pgvector', async () => {
    const id = created[0];
    const res = await request(app.getHttpServer())
      .post(`/documents/${id}/embed`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(false);

    const chunkCount = await prisma.documentChunk.count({
      where: { documentId: id },
    });
    expect(res.body.embeddedChunks).toBe(chunkCount);

    const rows = await prisma.$queryRaw<Array<{ d: number }>>`
      SELECT vector_dims(e."embedding") AS d
      FROM "Embedding" e
      JOIN "DocumentChunk" c ON c.id = e."chunkId"
      WHERE c."documentId" = ${id}
      LIMIT 1
    `;
    expect(Number(rows[0]?.d)).toBe(1536);
  });

  it('truy vấn khoảng cách cosine: chunk gần nhất với chính nó có dist ≈ 0', async () => {
    const id = created[0];
    const [anchor] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM "Embedding" e
      JOIN "DocumentChunk" c ON c.id = e."chunkId"
      WHERE c."documentId" = ${id}
      ORDER BY c.sequence ASC
      LIMIT 1
    `;
    expect(anchor?.id).toBeDefined();

    const nearest = await prisma.$queryRaw<Array<{ id: string; dist: number }>>`
      SELECT e.id,
             e."embedding" <=> (SELECT "embedding" FROM "Embedding" WHERE id = ${anchor!.id}) AS dist
      FROM "Embedding" e
      JOIN "DocumentChunk" c ON c.id = e."chunkId"
      WHERE c."documentId" = ${id}
      ORDER BY dist ASC
      LIMIT 3
    `;
    expect(nearest[0]?.id).toBe(anchor!.id);
    expect(Number(nearest[0]?.dist)).toBeCloseTo(0, 5);
  });

  it('upload trùng bytes -> REJECTED là exact-duplicate', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'Quy chế (lần 2)', source: 'test', text: goodMarkdown });
    expect(res.status).toBe(201);
    created.push(res.body.document.id);
    expect(res.body.document.status).toBe('REJECTED');
    expect(res.body.ingestion.rejectedReason).toMatch(/[Tt]rùng lặp/);
    expect(res.body.document.duplicateOfId).toBe(created[0]);
    expect(res.body.embedding).toBeNull();
  });

  it('tài liệu quá ngắn -> REJECTED do chất lượng', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'Ngắn', source: 'test', text: 'Chỉ một câu ngắn.' });
    expect(res.status).toBe(201);
    created.push(res.body.document.id);
    expect(res.body.document.status).toBe('REJECTED');
    expect(
      res.body.document.qualityReport.issues.map(
        (i: { type: string }) => i.type,
      ),
    ).toContain('TOO_SHORT');
  });

  it('POST /documents/:id/chunk?strategy=fixed re-chunk (đưa doc về CHUNKING, xoá embedding cũ)', async () => {
    const up = await request(app.getHttpServer())
      .post('/documents')
      .send({
        title: 'Doc để re-chunk',
        source: 'test',
        text: `# Tài liệu benchmark\n\n${Array.from(
          { length: 25 },
          (_, i) =>
            `Đoạn ${i}. Nội dung khác nhau về nhiều chủ đề trong quy chế đào tạo của trường.`,
        ).join('\n\n')}`,
      });
    const id = up.body.document.id;
    created.push(id);
    expect(up.body.document.status).toBe('COMPLETED');

    const res = await request(app.getHttpServer())
      .post(`/documents/${id}/chunk`)
      .send({ strategy: 'fixed' });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('fixed');
    expect(res.body.chunkCount).toBeGreaterThan(0);

    const chunks = await request(app.getHttpServer()).get(
      `/documents/${id}/chunks`,
    );
    expect(chunks.body.items[0].metadata.strategy).toBe('fixed');
    expect(chunks.body.items[0].heading).toBeNull();

    // re-chunk xoá chunk cũ -> embedding cũ cũng bị xoá (cascade)
    const embCount = await prisma.embedding.count({
      where: { chunk: { documentId: id } },
    });
    expect(embCount).toBe(0);

    const doc = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(doc.body.status).toBe('CHUNKING');
  });

  it('MIME không hỗ trợ -> FAILED với lý do rõ ràng', async () => {
    const res = await request(app.getHttpServer()).post('/documents').send({
      title: 'binary',
      source: 'test',
      mimeType: 'application/x-tar',
      text: 'khong-phai-tar-that',
    });
    expect(res.status).toBe(201);
    created.push(res.body.document.id);
    expect(res.body.document.status).toBe('FAILED');
    expect(res.body.ingestion.rejectedReason).toMatch(/UNSUPPORTED_MIME|Parse/);
  });

  it('POST /documents rỗng -> 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});
