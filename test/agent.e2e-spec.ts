import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent.service';
import { FakeLlmProvider } from '../src/ai/llm/providers/fake-llm.provider';
import { PrismaService } from '../src/database/prisma.service';

/**
 * PHASE 17.6 (e2e) — persistence AgentRun/AgentStep với PostgreSQL THẬT +
 * `LLM_PROVIDER=fake` (jest-e2e.setup). Cần DB đã migrate:
 *   npm run test:e2e -- agent.e2e
 */
const RUN = !process.env.SKIP_DB_E2E;

(RUN ? describe : describe.skip)(
  'AgentService persistence (e2e) — PHASE 17.6',
  () => {
    let app: INestApplication;
    let agent: AgentService;
    let prisma: PrismaService;
    let fake: FakeLlmProvider;
    const runIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      agent = app.get(AgentService);
      prisma = app.get(PrismaService);
      fake = app.get(FakeLlmProvider);
    }, 60_000);

    afterAll(async () => {
      if (runIds.length) {
        await prisma.agentRun
          .deleteMany({ where: { id: { in: runIds } } })
          .catch(() => undefined);
      }
      await app?.close();
    });

    it('run trực tiếp (fake trả lời, không tool) → ABSTAINED + persist', async () => {
      fake.scriptToolTurns([]);
      const res = await agent.run('Câu hỏi kiểm thử persistence.');
      runIds.push(res.id);

      // fake trả lời thẳng, không evidence ⇒ finalize abstain.
      expect(res.status).toBe('ABSTAINED');
      expect(res.finalStatus).toBe('INSUFFICIENT_EVIDENCE');

      const row = await prisma.agentRun.findUnique({ where: { id: res.id } });
      expect(row?.task).toBe('Câu hỏi kiểm thử persistence.');
      expect(row?.status).toBe('ABSTAINED');
      expect(row?.stepCount).toBeGreaterThan(0);
    }, 60_000);

    it('run có tool (scripted) → persist AgentStep với index duy nhất', async () => {
      fake.scriptToolTurns([
        { toolCalls: [{ name: 'calculator', args: { expression: '21*2' } }] },
        { content: 'Kết quả là 42.' },
      ]);
      const res = await agent.run('Tính 21 nhân 2.');
      runIds.push(res.id);

      const trace = await agent.getTrace(res.id);
      const steps = trace.steps as { index: number; type: string }[];
      expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
      expect(steps.map((s) => s.type)).toEqual([
        'THINK',
        'TOOL_CALL',
        'TOOL_RESULT',
        'THINK',
        'FINAL',
      ]);

      const got = await agent.get(res.id);
      expect(got.id).toBe(res.id);
      expect(got.stepCount).toBe(5);
    }, 60_000);

    it('get() 404 khi id không tồn tại', async () => {
      await expect(agent.get('agent_run_khong_ton_tai')).rejects.toThrow();
    });
  },
);
