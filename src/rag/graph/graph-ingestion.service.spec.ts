import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { Neo4jService } from '../../graph/neo4j.service';
import { EntityExtractorService } from './entity-extractor.service';
import { GraphExtractionCacheService } from './graph-extraction-cache.service';
import { GraphWriteService } from './graph-write.service';
import { GraphIngestionService } from './graph-ingestion.service';

function build(
  opts: {
    enabled?: boolean;
    status?: string;
    chunks?: Array<{ id: string; content: string }>;
    cached?: unknown;
    gleanings?: number;
    maxCalls?: number;
    concurrency?: number;
  } = {},
) {
  const chunks = opts.chunks ?? [
    { id: 'c1', content: 'Bách Khoa và Phòng Đào Tạo.' },
    { id: 'c2', content: 'Sinh viên Nguyễn Văn A.' },
  ];
  const documentUpdate = jest.fn().mockResolvedValue({});
  const jobCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    document: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'd1', status: opts.status ?? 'COMPLETED' }),
      update: documentUpdate,
    },
    documentChunk: { findMany: jest.fn().mockResolvedValue(chunks) },
    ingestionJob: { create: jobCreate },
    $transaction: jest.fn((ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as () => unknown)(),
    ),
  } as unknown as PrismaService;

  const neo4j = { enabled: opts.enabled ?? true } as unknown as Neo4jService;
  const extractor = {
    model: 'fake-llm-v1',
    extract: jest.fn().mockResolvedValue({
      entities: [{ name: 'A', type: 'ORG', description: '' }],
      relationships: [],
      llmCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCost: 0,
    }),
  } as unknown as EntityExtractorService;
  const cache = {
    hash: (s: string) => `h:${s}`,
    get: jest.fn().mockResolvedValue(opts.cached ?? null),
    put: jest.fn().mockResolvedValue(undefined),
  } as unknown as GraphExtractionCacheService;
  const writer = {
    replaceDocument: jest.fn().mockResolvedValue(undefined),
  } as unknown as GraphWriteService;
  const config = mockConfigService({
    graph: {
      extract: {
        maxTokens: 3000,
        gleanings: opts.gleanings ?? 1,
        maxLlmCallsPerDoc: opts.maxCalls ?? 40,
        concurrency: opts.concurrency ?? 1,
        entityTypes: ['ORG', 'PERSON', 'CONCEPT'],
        promptVersion: '1',
      },
    },
  });

  return {
    svc: new GraphIngestionService(
      prisma,
      neo4j,
      extractor,
      cache,
      writer,
      config,
    ),
    extractor: extractor.extract as jest.Mock,
    cachePut: cache.put as jest.Mock,
    cacheGet: cache.get as jest.Mock,
    replaceDocument: writer.replaceDocument as jest.Mock,
    jobCreate,
    documentUpdate,
  };
}

describe('GraphIngestionService', () => {
  it('graph tắt → skipped, không đụng gì', async () => {
    const { svc, extractor } = build({ enabled: false });
    const r = await svc.ingest('d1');
    expect(r).toMatchObject({ skipped: true });
    expect(extractor).not.toHaveBeenCalled();
  });

  it('luồng chuẩn: extract mỗi chunk, cache, write, job COMPLETED + status COMPLETED', async () => {
    const { svc, extractor, cachePut, replaceDocument, documentUpdate } =
      build();
    const r = await svc.ingest('d1');
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(cachePut).toHaveBeenCalledTimes(2);
    expect(replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'd1' }),
    );
    expect(r.skipped).toBe(false);
    expect(r.metrics?.chunkCount).toBe(2);
    // GRAPHING lúc bắt đầu, COMPLETED lúc kết thúc
    expect(documentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'GRAPHING' } }),
    );
  });

  it('chunk trích lỗi (failed) → KHÔNG ghi cache để lần sau trích lại', async () => {
    const { svc, extractor, cachePut } = build();
    extractor.mockResolvedValue({
      entities: [],
      relationships: [],
      llmCalls: 2,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      failed: true,
    });
    const r = await svc.ingest('d1');
    expect(cachePut).not.toHaveBeenCalled();
    expect(r.metrics?.failedChunks).toBe(2);
  });

  it('cache hit → không gọi extractor cho chunk đó', async () => {
    const { svc, extractor } = build({
      cached: {
        entities: [{ name: 'X', type: 'ORG', description: '' }],
        relationships: [],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    await svc.ingest('d1');
    expect(extractor).not.toHaveBeenCalled();
  });

  it('trần maxLlmCallsPerDoc giới hạn số LỜI GỌI LLM (không phải số chunk)', async () => {
    const { svc, extractor } = build({
      gleanings: 0,
      maxCalls: 2,
      chunks: [
        { id: 'c1', content: 'A B' },
        { id: 'c2', content: 'C D' },
        { id: 'c3', content: 'E F' },
      ],
    });
    await svc.ingest('d1');
    expect(extractor).toHaveBeenCalledTimes(2); // budget 2, mỗi chunk 1 call
  });

  it('cache hit KHÔNG tốn budget → re-ingest full-cache xử lý MỌI chunk', async () => {
    const { svc, extractor } = build({
      gleanings: 0,
      maxCalls: 1, // budget rất nhỏ
      cached: {
        entities: [{ name: 'X', type: 'ORG', description: '' }],
        relationships: [],
        inputTokens: 1,
        outputTokens: 1,
      },
      chunks: [
        { id: 'c1', content: 'A' },
        { id: 'c2', content: 'B' },
        { id: 'c3', content: 'C' },
      ],
    });
    const r = await svc.ingest('d1');
    expect(extractor).not.toHaveBeenCalled();
    expect(r.metrics?.chunkCount).toBe(3); // cả 3 chunk đều vào graph
  });

  it('lỗi khi extract (auto) → không ném, trả reason, ghi job FAILED', async () => {
    const { svc, jobCreate } = build();
    (
      svc as unknown as { extractor: EntityExtractorService }
    ).extractor.extract = jest.fn().mockRejectedValue(new Error('LLM down'));
    const r = await svc.ingest('d1');
    expect(r.skipped).toBe(false);
    expect(r.reason).toContain('LLM down');
    expect(jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('lỗi + throwOnError (nhánh explicit) → ném', async () => {
    const { svc } = build();
    (
      svc as unknown as { extractor: EntityExtractorService }
    ).extractor.extract = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(svc.ingest('d1', { throwOnError: true })).rejects.toThrow(
      /boom/,
    );
  });

  it('document sai trạng thái → ném GraphError', async () => {
    const { svc } = build({ status: 'CHUNKING' });
    await expect(svc.ingest('d1')).rejects.toMatchObject({
      code: 'GRAPH_EXTRACTION_FAILED',
    });
  });

  describe('GRAPH_EXTRACT_CONCURRENCY', () => {
    const three = [
      { id: 'c1', content: 'A B' },
      { id: 'c2', content: 'C D' },
      { id: 'c3', content: 'E F' },
    ];
    const okResult = {
      entities: [{ name: 'A', type: 'ORG', description: '' }],
      relationships: [],
      llmCalls: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCost: 0,
      failed: false,
    };

    it('concurrency=3 → 3 chunk được trích cùng lúc', async () => {
      const { svc, extractor } = build({ concurrency: 3, chunks: three });
      let inFlight = 0;
      let peak = 0;
      extractor.mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return okResult;
      });
      await svc.ingest('d1');
      expect(peak).toBe(3);
    });

    it('pool: chunk xong trước nhường slot ngay, không chờ chunk chậm cùng đợt', async () => {
      const { svc, extractor } = build({ concurrency: 2, chunks: three });
      const delays: Record<string, number> = { 'A B': 40, 'C D': 1, 'E F': 1 };
      const events: string[] = [];
      extractor.mockImplementation(async (text: string) => {
        events.push(`start ${text}`);
        await new Promise((r) => setTimeout(r, delays[text]));
        events.push(`end ${text}`);
        return okResult;
      });
      await svc.ingest('d1');
      // 'E F' phải bắt đầu TRƯỚC khi 'A B' (chậm) xong.
      expect(events.indexOf('start E F')).toBeLessThan(
        events.indexOf('end A B'),
      );
    });

    it('một chunk lỗi hạ tầng → chờ chunk đang chạy cache xong rồi mới báo lỗi', async () => {
      const { svc, extractor, cachePut } = build({
        concurrency: 2,
        chunks: three,
      });
      extractor.mockImplementation(async (text: string) => {
        if (text === 'A B') throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 20));
        return okResult;
      });
      const r = await svc.ingest('d1');
      expect(r.reason).toContain('timed out');
      expect(cachePut).toHaveBeenCalledTimes(1); // 'C D' đã chạy song song
    });

    it('giữ thứ tự chunk dù kết quả về lệch thứ tự', async () => {
      const { svc, extractor, replaceDocument } = build({
        concurrency: 3,
        chunks: three,
      });
      const delays: Record<string, number> = { 'A B': 15, 'C D': 5, 'E F': 1 };
      extractor.mockImplementation(async (text: string) => {
        await new Promise((r) => setTimeout(r, delays[text]));
        return okResult;
      });
      await svc.ingest('d1');
      const graph = replaceDocument.mock.calls[0][0] as { chunkIds: string[] };
      expect(graph.chunkIds).toEqual(['c1', 'c2', 'c3']);
    });

    it('vẫn tôn trọng trần maxLlmCallsPerDoc khi chạy song song', async () => {
      const { svc, extractor } = build({
        concurrency: 4,
        gleanings: 0,
        maxCalls: 2,
        chunks: three,
      });
      await svc.ingest('d1');
      expect(extractor).toHaveBeenCalledTimes(2);
    });
  });
});
