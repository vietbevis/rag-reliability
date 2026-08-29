import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors';
import { PrismaService } from '../src/database/prisma.service';

/**
 * E2E PHASE 4 — baseline RAG. Setup ép `EMBEDDING_PROVIDER=fake` +
 * `LLM_PROVIDER=fake` (tất định) nên retrieval score là nhiễu — chỉ assert chặt
 * vào plumbing / abstention, lỏng vào chất lượng.
 */
describe('RAG baseline (e2e) — PHASE 4', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  const corpus = `# Quy chế bảo lưu kết quả học tập

## Điều 1. Thời gian bảo lưu

Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học. Việc bảo lưu quá thời hạn này chỉ được xem xét trong trường hợp bất khả kháng.

## Điều 2. Thủ tục

Đơn xin bảo lưu phải nộp cho phòng đào tạo trước ngày bắt đầu học kỳ ít nhất mười lăm ngày làm việc. Đơn phải có xác nhận của cố vấn học tập.

## Điều 3. Quyền lợi

Trong thời gian bảo lưu, sinh viên không được hưởng các chế độ chính sách của trường và không được đăng ký học phần.
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

    const res = await request(app.getHttpServer()).post('/documents').send({
      title: 'Quy chế bảo lưu',
      source: 'phòng đào tạo',
      text: corpus,
    });
    created.push(res.body.document.id);
    expect(res.body.document.status).toBe('COMPLETED');
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.document.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.ragQuery.deleteMany({
      where: { query: { contains: '[e2e]' } },
    });
    await app.close();
  });

  it('POST /rag/search — chỉ retrieval, KHÔNG gọi LLM, trả chunk có score', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/search')
      .send({
        query: 'Sinh viên được bảo lưu bao lâu?',
        topK: 5,
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('vector');
    expect(res.body.count).toBeGreaterThan(0);
    const r0 = res.body.results[0];
    expect(r0.chunkId).toBeDefined();
    expect(r0.documentId).toBe(created[0]);
    expect(typeof r0.score).toBe('number');
    expect(r0.score).toBeGreaterThanOrEqual(0);
    expect(r0.score).toBeLessThanOrEqual(1);
    expect(r0.content).toContain('bảo lưu');
  });

  it('POST /rag/search strategy=keyword — full-text, khớp từ khoá "bảo lưu"', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/search')
      .send({
        query: 'bảo lưu học kỳ',
        strategy: 'keyword',
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('keyword');
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.results[0].source).toBe('keyword');
    expect(res.body.results[0].content).toContain('bảo lưu');
  });

  it('POST /rag/search strategy=hybrid — fusion vector + keyword (+ graph skip)', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/search')
      .send({
        query: 'thủ tục xin bảo lưu nộp cho ai',
        strategy: 'hybrid',
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('hybrid');
    expect(res.body.count).toBeGreaterThan(0);
    for (const r of res.body.results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(['vector', 'keyword', 'graph', 'hybrid']).toContain(r.source);
    }
  });

  it('POST /rag/query strategy=hybrid — persist RetrievalLog strategy=hybrid', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({
        query: '[e2e] Đơn xin bảo lưu nộp trước bao nhiêu ngày?',
        strategy: 'hybrid',
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    const rq = await prisma.ragQuery.findUnique({
      where: { id: res.body.id },
      include: { retrievalLogs: true },
    });
    expect(rq?.retrievalLogs[0]?.strategy).toBe('hybrid');
  });

  it('POST /rag/query rerank=true — trace.rerank có method fake, chunk sau rerank', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({
        query: '[e2e] Đơn xin bảo lưu nộp cho ai, trước bao lâu?',
        rerank: true,
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.trace.rerank).toMatchObject({
      enabled: true,
      method: 'fake',
      fellBack: false,
    });
    expect(res.body.retrieval.chunkCount).toBeGreaterThan(0);
    // score = rerankScore ∈ [0,1]
    for (const c of res.body.retrieval.chunks) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it('POST /rag/query — luồng đầy đủ, persist RagQuery + RetrievalLog', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({
        query: '[e2e] Sinh viên được bảo lưu tối đa mấy học kỳ?',
        filters: { documentIds: [created[0]] },
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect([
      'GROUNDED',
      'PARTIALLY_GROUNDED',
      'INSUFFICIENT_EVIDENCE',
    ]).toContain(res.body.status);
    expect(res.body.answer).toBeTruthy();
    expect(res.body.retrieval.chunkCount).toBeGreaterThan(0);
    expect(res.body.provider).toBe('fake');
    expect(res.body.usage).toHaveProperty('embeddingTokens');
    expect(res.body.usage).toHaveProperty('inputTokens');

    const rq = await prisma.ragQuery.findUnique({
      where: { id: res.body.id },
      include: { retrievalLogs: true },
    });
    expect(rq?.answer).toBe(res.body.answer);
    expect(rq?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rq?.retrievalLogs.length).toBeGreaterThan(0);
    expect(rq?.retrievalLogs[0]?.strategy).toBe('vector');
  });

  it('POST /rag/query với filter documentIds không khớp -> INSUFFICIENT_EVIDENCE, không gọi LLM', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({
        query: '[e2e] câu hỏi bất kỳ',
        filters: { documentIds: ['does-not-exist'] },
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.body.answer).toMatch(/Không tìm thấy/);
    expect(res.body.retrieval.chunkCount).toBe(0);
    expect(res.body.usage.inputTokens).toBe(0); // không gọi LLM
  });

  it('POST /rag/query — validation: query quá ngắn -> 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({ query: 'a' });
    expect(res.status).toBe(400);
  });

  it('POST /rag/query — validation: filters lồng sai kiểu -> 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({ query: 'câu hỏi hợp lệ', filters: { documentIds: [123] } });
    expect(res.status).toBe(400);
  });

  it('POST /rag/search chỉ trả tài liệu COMPLETED (lọc status)', async () => {
    // Tạo doc REJECTED (quá ngắn) rồi đảm bảo nó không xuất hiện trong search.
    const rej = await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'x', source: 'y', text: 'Ngắn.' });
    created.push(rej.body.document.id);
    expect(rej.body.document.status).toBe('REJECTED');

    const res = await request(app.getHttpServer())
      .post('/rag/search')
      .send({
        query: 'ngắn',
        filters: { documentIds: [created[0], rej.body.document.id] },
      });
    const docIds: string[] = res.body.results.map(
      (r: { documentId: string }) => r.documentId,
    );
    expect(docIds).not.toContain(rej.body.document.id);
  });
});
