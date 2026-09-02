// Bật agent TRƯỚC khi ConfigModule.load() chạy (ở .compile()).
process.env.AGENT_ENABLED = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FakeLlmProvider } from '../src/ai/llm/providers/fake-llm.provider';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * PHASE 17.7 (e2e) — route /agent/* đồng bộ, DB THẬT + LLM fake.
 *   npm run test:e2e -- agent-http
 */
const RUN = !process.env.SKIP_DB_E2E;

(RUN ? describe : describe.skip)('Agent HTTP (e2e) — PHASE 17.7', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fake: FakeLlmProvider;
  const runIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    fake = app.get(FakeLlmProvider);
    fake.scriptToolTurns([]);
  }, 60_000);

  afterAll(async () => {
    if (runIds.length) {
      await prisma.agentRun
        .deleteMany({ where: { id: { in: runIds } } })
        .catch(() => undefined);
    }
    await app?.close();
    delete process.env.AGENT_ENABLED;
  });

  it('POST /agent/run → 200 + persist; GET runs/:id + trace', async () => {
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ task: 'Câu hỏi kiểm thử HTTP.' })
      .expect(200);
    runIds.push(res.body.id);

    expect(res.body).toMatchObject({
      task: 'Câu hỏi kiểm thử HTTP.',
      status: 'ABSTAINED',
      finalStatus: 'INSUFFICIENT_EVIDENCE',
    });

    await request(app.getHttpServer())
      .get(`/agent/runs/${res.body.id}`)
      .expect(200)
      .expect((r) => expect(r.body.id).toBe(res.body.id));

    await request(app.getHttpServer())
      .get(`/agent/runs/${res.body.id}/trace`)
      .expect(200)
      .expect((r) => expect(Array.isArray(r.body.steps)).toBe(true));
  }, 60_000);

  it('POST /agent/run task rỗng → 400', async () => {
    await request(app.getHttpServer())
      .post('/agent/run')
      .send({ task: '' })
      .expect(400);
  });

  it("execution:'async' khi QUEUE_ENABLED=false → fallback sync (200 + kết quả)", async () => {
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ task: 'Chạy async nhưng queue tắt.', execution: 'async' })
      .expect(200);
    runIds.push(res.body.id);
    expect(res.body.status).toBeDefined();
    expect(res.body.stepCount).toBeGreaterThan(0);
  }, 60_000);

  it('GET /agent/runs/:id không tồn tại → 404', async () => {
    await request(app.getHttpServer())
      .get('/agent/runs/khong_ton_tai')
      .expect(404);
  });

  it('POST /agent/runs/:id/cancel trên run đã xong → 409', async () => {
    fake.scriptToolTurns([]);
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ task: 'Run để test cancel.' })
      .expect(200);
    runIds.push(res.body.id);
    await request(app.getHttpServer())
      .post(`/agent/runs/${res.body.id}/cancel`)
      .expect(409);
  }, 60_000);

  it('GET /agent/runs/:id/stream → SSE text/event-stream, tự đóng', async () => {
    fake.scriptToolTurns([]);
    const created = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ task: 'Run để test stream.' })
      .expect(200);
    runIds.push(created.body.id);

    const sse = await request(app.getHttpServer())
      .get(`/agent/runs/${created.body.id}/stream`)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        let done = false;
        const finish = (): void => {
          if (!done) {
            done = true;
            cb(null, data);
          }
        };
        res.setEncoding('utf8');
        res.on('data', (c: string) => (data += c));
        res.on('end', finish);
        res.on('close', finish);
      });

    expect(sse.headers['content-type']).toMatch(/text\/event-stream/);
    expect(String(sse.body)).toMatch(/done|step/);
  }, 25_000);
});
