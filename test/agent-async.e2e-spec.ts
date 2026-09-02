// Bật agent TRƯỚC khi ConfigModule.load(). `QUEUE_ENABLED=true` phải truyền qua
// CLI (jest-e2e.setup không ghi đè giá trị đã đặt) vì BullModule đọc lúc import.
process.env.AGENT_ENABLED = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FakeLlmProvider } from '../src/ai/llm/providers/fake-llm.provider';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * PHASE 17.8 (e2e) — async BullMQ THẬT (cần Redis + PostgreSQL). Bỏ qua nếu
 * operator không bật:  AGENT_ASYNC_E2E=1 npm run test:e2e -- agent-async
 */
const RUN = process.env.AGENT_ASYNC_E2E === '1';

async function waitDone(
  http: ReturnType<INestApplication['getHttpServer']>,
  id: string,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(http).get(`/agent/runs/${id}`);
    if (res.body.status !== 'RUNNING')
      return res.body as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('agent run không kết thúc trong thời hạn');
}

(RUN ? describe : describe.skip)('Agent async (e2e) — PHASE 17.8', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runIds: string[] = [];

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
    app.get(FakeLlmProvider).scriptToolTurns([]);
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

  it("execution:'async' → 202 RUNNING, worker chạy nền tới xong", async () => {
    const http = app.getHttpServer();
    const res = await request(http)
      .post('/agent/run')
      .send({ task: 'Async run kiểm thử.', execution: 'async' })
      .expect(202);
    runIds.push(res.body.id);
    expect(res.body).toMatchObject({ status: 'RUNNING' });

    const final = await waitDone(http, res.body.id);
    expect(['COMPLETED', 'ABSTAINED']).toContain(final.status);
    expect(final.stepCount as number).toBeGreaterThan(0);
  }, 40_000);
});
