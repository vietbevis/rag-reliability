import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';
import { Neo4jService } from '../src/graph/neo4j.service';

/**
 * E2E PHASE 5 — Graph RAG construction với Neo4j THẬT. Chỉ chạy khi operator bật:
 *
 *   docker compose --profile graph up -d neo4j   # + docker-compose.override để lộ 7687
 *   GRAPH_RAG_ENABLED=true NEO4J_URI=bolt://localhost:7687 \
 *   NEO4J_PASSWORD=neo4jlocalpass npm run test:e2e
 *
 * `LLM_PROVIDER=fake` (jest-e2e.setup) → extraction tất định, không cần API key.
 */
const RUN = process.env.GRAPH_RAG_ENABLED === 'true' && !!process.env.NEO4J_URI;

(RUN ? describe : describe.skip)('Graph RAG (e2e) — PHASE 5', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let neo4j: Neo4jService;
  const created: string[] = [];

  const corpus = `# Quy chế đào tạo Bách Khoa

Trường Đại Học Bách Khoa Hà Nội ban hành quy chế. Phòng Đào Tạo quản lý hồ sơ.
Sinh viên Nguyễn Văn A theo học ngành Khoa Học Máy Tính do Khoa Công Nghệ Thông Tin phụ trách.

## Điều 1

Sinh viên phải tích luỹ đủ tín chỉ. Phòng Đào Tạo phối hợp Khoa Công Nghệ Thông Tin xét tốt nghiệp.
`;

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
    neo4j = app.get(Neo4jService);
  }, 60_000);

  afterAll(async () => {
    if (created.length) {
      // Xoá qua service để dọn cả Neo4j.
      for (const id of created) {
        await request(app.getHttpServer())
          .delete(`/documents/${id}`)
          .catch(() => undefined);
      }
      await prisma.document
        .deleteMany({ where: { id: { in: created } } })
        .catch(() => undefined);
    }
    await app?.close();
  });

  it('GET /health — neo4j up khi bật', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.body.info.neo4j.status).toBe('up');
    expect(res.body.info.neo4j.enabled).toBe(true);
  });

  it('POST /documents → pipeline chạy tới COMPLETED, graph được dựng', async () => {
    const res = await request(app.getHttpServer()).post('/documents').send({
      title: 'QC Bách Khoa',
      source: 'e2e-graph-qc',
      text: corpus,
    });
    expect(res.status).toBe(201);
    expect(res.body.document.status).toBe('COMPLETED');
    expect(res.body.graph.skipped).toBe(false);
    expect(res.body.graph.metrics.entityCount).toBeGreaterThan(0);
    created.push(res.body.document.id);
  }, 60_000);

  it('GET /documents/:id/graph — tóm tắt entity/quan hệ', async () => {
    const res = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/graph`,
    );
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.entityCount).toBeGreaterThan(0);
    expect(res.body.lastRun.status).toBe('COMPLETED');
  });

  it('POST /documents/:id/graph — re-run idempotent (cache hit, count ổn định)', async () => {
    const before = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/graph`,
    );
    const rerun = await request(app.getHttpServer()).post(
      `/documents/${created[0]}/graph`,
    );
    expect(rerun.status).toBe(200);
    expect(rerun.body.metrics.cacheHits).toBeGreaterThan(0);
    expect(rerun.body.metrics.llmCalls).toBe(0);
    const after = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/graph`,
    );
    expect(after.body.entityCount).toBe(before.body.entityCount);
    expect(after.body.relationshipCount).toBe(before.body.relationshipCount);
  }, 60_000);

  it('DELETE /documents/:id — dọn sạch graph của tài liệu', async () => {
    const id = created.pop()!;
    const del = await request(app.getHttpServer()).delete(`/documents/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.graphCleaned).toBe(true);

    const remaining = await neo4j.read<{ n: number }>(
      `MATCH (c:Chunk {documentId: $d}) RETURN count(c) AS n`,
      { d: id },
    );
    expect(remaining[0]?.n ?? 0).toBe(0);
  });

  it('POST /graph/reconcile — không xoá gì khi graph đã nhất quán', async () => {
    const res = await request(app.getHttpServer()).post('/graph/reconcile');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('validDocuments');
  });
});
