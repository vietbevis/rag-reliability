import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * E2E PHASE 1: upload -> ingest -> CRUD -> dedup -> quality reject.
 * Cần PostgreSQL + pgvector + migration đã áp.
 */
describe('Documents ingestion (e2e) — PHASE 1', () => {
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

  it('POST /documents (text) -> ingest thành công, status VALIDATING', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'Quy chế', source: 'test', text: goodMarkdown });
    expect(res.status).toBe(201);
    created.push(res.body.document.id);

    expect(res.body.document.status).toBe('VALIDATING');
    expect(res.body.document.parserUsed).toBe('PLAINTEXT');
    expect(res.body.document.qualityScore).toBeGreaterThan(0.7);
    expect(res.body.document.checksum).toHaveLength(64);
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

  it('GET /documents/:id/jobs liệt kê các stage kèm thời gian', async () => {
    const res = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/jobs`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    expect(
      res.body.every((j: { status: string }) => j.status === 'COMPLETED'),
    ).toBe(true);
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
