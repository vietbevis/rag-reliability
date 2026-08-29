import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * E2E PHASE 4 — khung đánh giá. `jest-e2e.setup.ts` trỏ `EVAL_DATASETS_DIR` vào
 * `test/fixtures/eval-datasets/` (dataset `e2e-mini`, 2 case) và ép
 * `LLM_PROVIDER=fake` nên `mode: full` chạy được không cần API key.
 */
describe('Evaluation harness (e2e) — PHASE 4', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baselineRunId: string;

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
  }, 60_000);

  afterAll(async () => {
    await prisma.evaluationDataset
      .deleteMany({ where: { name: 'e2e-mini' } })
      .catch(() => undefined);
    await prisma.document
      .deleteMany({ where: { source: 'e2e-quy-che' } })
      .catch(() => undefined);
    await app.close();
  });

  it('POST /evaluation/run (mode=full) — chạy dataset, trả metrics, persist', async () => {
    const res = await request(app.getHttpServer())
      .post('/evaluation/run')
      .send({ datasetName: 'e2e-mini', mode: 'full', isBaseline: true });

    expect(res.status).toBe(200);
    expect(res.body.runId).toBeDefined();
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.caseCount).toBe(2);
    expect(res.body.metrics.cases).toBe(2);
    expect(typeof res.body.metrics.recallAt5).toBe('number');
    expect(typeof res.body.metrics.abstentionAccuracy).toBe('number');
    baselineRunId = res.body.runId;

    const run = await prisma.evaluationRun.findUnique({
      where: { id: baselineRunId },
      include: { results: true },
    });
    expect(run?.results.length).toBe(2);
    expect(run?.isBaseline).toBe(true);
  }, 60_000);

  it('GET /evaluation/runs/:id — chi tiết kèm kết quả từng case', async () => {
    const res = await request(app.getHttpServer()).get(
      `/evaluation/runs/${baselineRunId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    const ids = res.body.results
      .map((r: { caseId: string }) => r.caseId)
      .sort();
    expect(ids).toEqual(['e2e-ans-1', 'e2e-unans-1']);
  });

  it('GET /evaluation/runs?datasetName= — liệt kê run', async () => {
    const res = await request(app.getHttpServer())
      .get('/evaluation/runs')
      .query({ datasetName: 'e2e-mini' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].datasetName).toBe('e2e-mini');
  });

  it('POST /evaluation/runs/:id/compare — so với baseline', async () => {
    const second = await request(app.getHttpServer())
      .post('/evaluation/run')
      .send({ datasetName: 'e2e-mini', mode: 'retrieval' });
    expect(second.status).toBe(200);

    const res = await request(app.getHttpServer())
      .post(`/evaluation/runs/${second.body.runId}/compare`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.baselineRunId).toBe(baselineRunId);
    expect(Array.isArray(res.body.deltas)).toBe(true);
    expect(typeof res.body.regressed).toBe('boolean');
  }, 60_000);

  it('POST /evaluation/run — dataset không tồn tại -> lỗi có lý do', async () => {
    const res = await request(app.getHttpServer())
      .post('/evaluation/run')
      .send({ datasetName: 'khong-co-that' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
