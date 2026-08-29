import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';

/**
 * E2E PHASE 0: xác nhận ứng dụng boot và các endpoint hạ tầng hoạt động.
 * Cần PostgreSQL + pgvector đang chạy (docker compose up -d postgres) và một
 * `.env` hợp lệ. `POST /ai/providers/test` phải xử lý êm khi không có API key.
 */
describe('RAG Reliability Service (e2e) — PHASE 0', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200 và database "up"', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info).toHaveProperty('database');
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info).toHaveProperty('pgvector');
  });

  it('GET /health/live → 200', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ai/providers liệt kê 5 LLM + 4 embedding provider (gồm fake)', async () => {
    const res = await request(app.getHttpServer()).get('/ai/providers');
    expect(res.status).toBe(200);
    expect(res.body.llm.providers).toHaveLength(5);
    expect(res.body.embedding.providers).toHaveLength(4);
    expect(
      res.body.llm.providers.map((p: { provider: string }) => p.provider),
    ).toContain('fake');
    expect(
      res.body.embedding.providers.map((p: { provider: string }) => p.provider),
    ).toContain('fake');
    expect(res.body.embedding.dimension).toBe(1536);
    expect(['openai', 'gemini', 'anthropic', 'custom', 'fake']).toContain(
      res.body.llm.active,
    );
  });

  it('POST /ai/providers/test xử lý êm khi provider chưa cấu hình', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/providers/test')
      .send({ provider: 'gemini' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.configured).toBe(false);
  });

  it('POST /ai/providers/test từ chối provider không hợp lệ (validation)', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/providers/test')
      .send({ provider: 'not-a-provider' });
    expect(res.status).toBe(400);
  });
});
