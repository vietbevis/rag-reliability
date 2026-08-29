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
 *
 * PHASE 1 (queue): `jest-e2e.setup` đặt `QUEUE_ENABLED=false` → POST /documents
 * chạy pipeline INLINE và trả 202 khi đã xong (body.document là trạng thái cuối,
 * body.jobId = null). Chi tiết từng bước lấy qua GET /:id, /:id/jobs, /:id/chunks.
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

  /** Upload text, kỳ vọng 202, trả về id + body (đã chạy inline nên là cuối). */
  async function upload(body: Record<string, unknown>): Promise<{
    id: string;
    document: Record<string, unknown>;
    status: string;
    jobId: string | null;
  }> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send(body);
    expect(res.status).toBe(202);
    created.push(res.body.document.id);
    return {
      id: res.body.document.id,
      document: res.body.document,
      status: res.body.status,
      jobId: res.body.jobId,
    };
  }

  const jobStages = async (id: string): Promise<string[]> => {
    const res = await request(app.getHttpServer()).get(`/documents/${id}/jobs`);
    expect(res.status).toBe(200);
    return res.body.map((j: { stage: string }) => j.stage);
  };

  it('POST /documents (text) -> 202, pipeline inline chạy tới COMPLETED', async () => {
    const { id, document, status, jobId } = await upload({
      title: 'Quy chế',
      source: 'test',
      text: goodMarkdown,
    });

    expect(status).toBe('COMPLETED');
    expect(jobId).toBeNull(); // QUEUE_ENABLED=false
    expect(document.status).toBe('COMPLETED');
    expect(document.parserUsed).toBe('PLAINTEXT');
    expect(document.qualityScore as number).toBeGreaterThan(0.7);
    expect(document.checksum as string).toHaveLength(64);

    // Các bước lấy qua endpoint chuyên biệt (không còn lồng trong response upload).
    const chunks = await request(app.getHttpServer()).get(
      `/documents/${id}/chunks`,
    );
    expect(chunks.body.total).toBeGreaterThan(0);
    expect(chunks.body.items[0].metadata.strategy).toBe('structure');

    const emb = await request(app.getHttpServer()).get(
      `/documents/${id}/embeddings`,
    );
    expect(emb.body.total).toBe(chunks.body.total);
    expect(emb.body.byModel[0]).toEqual(
      expect.objectContaining({ provider: 'fake', dimensions: 1024 }),
    );

    expect(await jobStages(id)).toEqual(
      expect.arrayContaining(['PARSE', 'NORMALIZE', 'CLEAN', 'QUALITY', 'CHUNK', 'EMBED']),
    );
  });

  it('GET /documents/:id trả về document đã cleaned + jobState', async () => {
    const id = created[0];
    const res = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.cleanedText).toContain('Quy chế đào tạo');
    expect(Array.isArray(res.body.transformations)).toBe(true);
    // queue tắt → không có job BullMQ.
    expect(res.body.jobState).toBeNull();
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
        dimensions: 1024,
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
    expect(Number(rows[0]?.d)).toBe(1024);
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
    const { id, document } = await upload({
      title: 'Quy chế (lần 2)',
      source: 'test',
      text: goodMarkdown,
    });
    expect(document.status).toBe('REJECTED');
    expect(document.duplicateOfId).toBe(created[0]);

    const doc = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(doc.body.rejectedReason).toMatch(/[Tt]rùng lặp/);
    const embChunks = await prisma.embedding.count({
      where: { chunk: { documentId: id } },
    });
    expect(embChunks).toBe(0);
  });

  it('tài liệu quá ngắn -> REJECTED do chất lượng', async () => {
    const { document } = await upload({
      title: 'Ngắn',
      source: 'test',
      text: 'Chỉ một câu ngắn.',
    });
    expect(document.status).toBe('REJECTED');
    expect(
      (document.qualityReport as { issues: Array<{ type: string }> }).issues.map(
        (i) => i.type,
      ),
    ).toContain('TOO_SHORT');
  });

  it('POST /documents/:id/chunk?strategy=fixed re-chunk (đưa doc về CHUNKING, xoá embedding cũ)', async () => {
    const { id, document } = await upload({
      title: 'Doc để re-chunk',
      source: 'test',
      text: `# Tài liệu benchmark\n\n${Array.from(
        { length: 25 },
        (_, i) =>
          `Đoạn ${i}. Nội dung khác nhau về nhiều chủ đề trong quy chế đào tạo của trường.`,
      ).join('\n\n')}`,
    });
    expect(document.status).toBe('COMPLETED');

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

    const embCount = await prisma.embedding.count({
      where: { chunk: { documentId: id } },
    });
    expect(embCount).toBe(0);

    const doc = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(doc.body.status).toBe('CHUNKING');
  });

  it('POST /documents/:id/ingest -> 202, chạy lại pipeline inline', async () => {
    const id = created[0];
    const res = await request(app.getHttpServer())
      .post(`/documents/${id}/ingest`)
      .send();
    expect(res.status).toBe(202);
    expect(res.body).toEqual(
      expect.objectContaining({ jobId: null, ranInline: true }),
    );
  });

  it('MIME không hỗ trợ -> FAILED với lý do rõ ràng', async () => {
    const { id, document } = await upload({
      title: 'binary',
      source: 'test',
      mimeType: 'application/x-tar',
      text: 'khong-phai-tar-that',
    });
    expect(document.status).toBe('FAILED');
    const doc = await request(app.getHttpServer()).get(`/documents/${id}`);
    expect(doc.body.rejectedReason).toMatch(/UNSUPPORTED_MIME|Parse/);
  });

  it('POST /documents rỗng -> 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});
