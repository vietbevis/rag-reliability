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
    expect(res.status).toBe(202);
    expect(res.body.document.status).toBe('COMPLETED'); // QUEUE_ENABLED=false → inline
    created.push(res.body.document.id);

    const graph = await request(app.getHttpServer()).get(
      `/documents/${res.body.document.id}/graph`,
    );
    expect(graph.body.entityCount).toBeGreaterThan(0);
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
    expect(rerun.status).toBe(202);
    expect(rerun.body.ranInline).toBe(true); // QUEUE_ENABLED=false

    // Metrics của lần chạy GRAPH mới nhất lấy từ IngestionJob.
    const lastGraphJob = await prisma.ingestionJob.findFirst({
      where: { documentId: created[0], stage: 'GRAPH' },
      orderBy: { createdAt: 'desc' },
    });
    const metrics = lastGraphJob?.metrics as {
      cacheHits: number;
      llmCalls: number;
    };
    expect(metrics.cacheHits).toBeGreaterThan(0);
    expect(metrics.llmCalls).toBe(0);

    const after = await request(app.getHttpServer()).get(
      `/documents/${created[0]}/graph`,
    );
    expect(after.body.entityCount).toBe(before.body.entityCount);
    expect(after.body.relationshipCount).toBe(before.body.relationshipCount);
  }, 60_000);

  it('POST /rag/search strategy=graph — traversal từ entity trong query', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/search')
      .send({
        query: 'Phòng Đào Tạo phối hợp với đơn vị nào?',
        strategy: 'graph',
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('graph');
    // fake NER + traversal → có thể ra chunk hoặc rỗng; chỉ assert plumbing
    for (const r of res.body.results) {
      expect(r.source).toBe('graph');
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

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

  it('entity chia sẻ giữa 2 tài liệu sống sót khi xoá 1; reconcile không xoá nhầm', async () => {
    const shared = `Phòng Đào Tạo phối hợp Khoa Công Nghệ Thông Tin quản lý sinh viên.`;
    const a = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'A', source: 'e2e-graph-a', text: `# A\n\n${shared}` });
    const b = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'B', source: 'e2e-graph-b', text: `# B\n\n${shared}` });
    created.push(a.body.document.id, b.body.document.id);

    const aId = a.body.document.id;
    const bId = b.body.document.id;

    // entity chia sẻ phải có cả 2 doc lúc này
    const shared0 = await neo4j.read<{ n: number }>(
      `MATCH (e:Entity) WHERE $a IN e.documentIds AND $b IN e.documentIds RETURN count(e) AS n`,
      { a: aId, b: bId },
    );
    expect(shared0[0]!.n).toBeGreaterThan(0);

    // xoá A → KHÔNG còn entity/cạnh nào tham chiếu A; entity chia sẻ vẫn còn (thuộc B)
    await request(app.getHttpServer()).delete(`/documents/${aId}`);
    created.splice(created.indexOf(aId), 1);

    const stillA = await neo4j.read<{ n: number }>(
      `MATCH (e:Entity) WHERE $a IN e.documentIds RETURN count(e) AS n`,
      { a: aId },
    );
    expect(stillA[0]!.n).toBe(0);
    const relA = await neo4j.read<{ n: number }>(
      `MATCH ()-[r:RELATED]->() WHERE $a IN r.documentIds RETURN count(r) AS n`,
      { a: aId },
    );
    expect(relA[0]!.n).toBe(0);
    const stillShared = await neo4j.read<{ n: number }>(
      `MATCH (e:Entity) WHERE $b IN e.documentIds RETURN count(e) AS n`,
      { b: bId },
    );
    expect(stillShared[0]!.n).toBeGreaterThan(0);

    // reconcile với danh sách doc hợp lệ hiện tại → không xoá gì của B
    const before = stillShared[0]!.n;
    const rec = await request(app.getHttpServer()).post('/graph/reconcile');
    expect(rec.status).toBe(200);
    const afterRec = await neo4j.read<{ n: number }>(
      `MATCH (e:Entity) WHERE $b IN e.documentIds RETURN count(e) AS n`,
      { b: bId },
    );
    expect(afterRec[0]!.n).toBe(before);
  }, 60_000);

  it('POST /graph/reconcile — không xoá gì khi graph đã nhất quán', async () => {
    const res = await request(app.getHttpServer()).post('/graph/reconcile');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('validDocuments');
  });
});
