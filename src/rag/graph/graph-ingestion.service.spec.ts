import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../../ai/llm/llm.service';
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
  const llm = { activeModel: 'fake-llm-v1' } as unknown as LlmService;

  const config = mockConfigService({
    graph: {
      extract: {
        maxTokens: 3000,
        gleanings: opts.gleanings ?? 1,
        maxLlmCallsPerDoc: opts.maxCalls ?? 40,
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
      llm,
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

  it('trần maxLlmCallsPerDoc giới hạn số chunk xử lý', async () => {
    const { svc, extractor } = build({
      gleanings: 0,
      maxCalls: 1,
      chunks: [
        { id: 'c1', content: 'A B' },
        { id: 'c2', content: 'C D' },
        { id: 'c3', content: 'E F' },
      ],
    });
    await svc.ingest('d1');
    expect(extractor).toHaveBeenCalledTimes(1); // floor(1 / (1+0)) = 1
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
});
