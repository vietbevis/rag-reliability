import { mockConfigService } from '../../config/config.mock';
import { EmbeddingError } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import { VectorSchemaService } from '../embedding/vector-schema.service';
import { VectorRetrieverService } from './vector-retriever.service';

function build(
  opts: {
    rows?: unknown[];
    configured?: boolean;
    embedThrows?: boolean;
    distance?: 'cosine' | 'l2' | 'ip';
    hnsw?: { efSearch?: number; iterativeScan?: boolean };
  } = {},
) {
  const queryRaw = jest.fn().mockResolvedValue(opts.rows ?? []);
  const executeRawUnsafe = jest.fn().mockResolvedValue(0);
  const transaction = jest.fn((promises: Promise<unknown>[]) =>
    Promise.all(promises),
  );
  const prisma = {
    $queryRaw: queryRaw,
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: transaction,
  } as unknown as PrismaService;

  const embed = opts.embedThrows
    ? jest.fn().mockRejectedValue(new EmbeddingError('AUTH', 'no key'))
    : jest.fn().mockResolvedValue({
        vector: [0.1, 0.2, 0.3],
        usage: { inputTokens: 5, totalTokens: 5, estimatedCost: 0.001 },
        model: 'm',
      });
  const embeddings = {
    isConfigured: () => opts.configured ?? true,
    embed,
    activeModel: 'text-embedding-3-small',
  } as unknown as EmbeddingService;

  const distanceOperator =
    opts.distance === 'l2' ? '<->' : opts.distance === 'ip' ? '<#>' : '<=>';
  const vectorSchema = {
    distanceOperator,
  } as unknown as VectorSchemaService;

  const config = mockConfigService({
    embedding: { distance: opts.distance ?? 'cosine' },
    retrieval: opts.hnsw
      ? {
          hnsw: {
            efSearch: opts.hnsw.efSearch ?? 0,
            iterativeScan: opts.hnsw.iterativeScan ?? false,
          },
        }
      : undefined,
  });

  return {
    svc: new VectorRetrieverService(prisma, embeddings, vectorSchema, config),
    queryRaw,
    executeRawUnsafe,
    transaction,
    embed,
  };
}

const row = (id: string, distance: number) => ({
  id,
  documentId: 'd0',
  content: `chunk ${id}`,
  heading: null,
  section: 'Điều 1',
  page: null,
  metadata: { strategy: 'fixed' },
  distance,
});

describe('VectorRetrieverService', () => {
  it('embed query rồi trả chunk, score chuẩn hoá [0,1] giảm theo distance', async () => {
    const { svc } = build({ rows: [row('a', 0.1), row('b', 0.9)] });
    const r = await svc.retrieve({ query: 'câu hỏi', topK: 5 });
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0]!.score).toBeGreaterThan(r.chunks[1]!.score);
    expect(r.chunks[0]!.score).toBeLessThanOrEqual(1);
    expect(r.chunks[0]!.score).toBeGreaterThanOrEqual(0);
    expect(r.chunks[0]!.source).toBe('vector');
    expect(r.chunks[0]!.section).toBe('Điều 1');
    expect(r.embeddingTokens).toBe(5);
    expect(r.estimatedCost).toBe(0.001);
  });

  it('distance=ip (<#>): score phân biệt được, similarity dương -> KHÔNG kẹt ở 1.0', async () => {
    // <#> = -inner_product; similarity 0.9 -> distance -0.9, similarity 0.2 -> -0.2
    const { svc } = build({
      distance: 'ip',
      rows: [row('a', -0.9), row('b', -0.2)],
    });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks[0]!.score).toBeCloseTo(0.95, 4); // (1 - (-0.9)) / 2
    expect(r.chunks[1]!.score).toBeCloseTo(0.6, 4); // (1 - (-0.2)) / 2
    expect(r.chunks[0]!.score).toBeGreaterThan(r.chunks[1]!.score);
  });

  it('distance=cosine: score = 1 - distance/2', async () => {
    const { svc } = build({ rows: [row('a', 0.2)] });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks[0]!.score).toBeCloseTo(0.9, 4);
  });

  it('embedding provider chưa cấu hình -> trả rỗng, không query', async () => {
    const { svc, queryRaw, embed } = build({ configured: false });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(r.trace.skipped).toBeDefined();
  });

  it('embed query lỗi -> trả rỗng + trace.error (PROMPT §54)', async () => {
    const { svc, queryRaw } = build({ embedThrows: true });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks).toEqual([]);
    expect(r.trace.error).toBe('embed_query_failed');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('truyền filters vào query (không ném)', async () => {
    const { svc, queryRaw } = build({ rows: [] });
    await svc.retrieve({
      query: 'q',
      topK: 3,
      filters: {
        documentIds: ['d1', 'd2'],
        sources: ['phòng ĐT'],
        metadata: { strategy: 'fixed' },
      },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  describe('tinh chỉnh HNSW (PHASE 16)', () => {
    it('mặc định (efSearch=0, iterativeScan=false) → KHÔNG vào transaction', async () => {
      const { svc, transaction, executeRawUnsafe } = build({
        rows: [row('a', 0.2)],
      });
      await svc.retrieve({ query: 'q', topK: 5 });
      expect(transaction).not.toHaveBeenCalled();
      expect(executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('efSearch > 0 → SET LOCAL hnsw.ef_search trong 1 transaction, vẫn trả rows', async () => {
      const { svc, transaction, executeRawUnsafe } = build({
        rows: [row('a', 0.2), row('b', 0.4)],
        hnsw: { efSearch: 100 },
      });
      const r = await svc.retrieve({ query: 'q', topK: 5 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL hnsw.ef_search = 100',
      );
      expect(r.chunks).toHaveLength(2);
      expect(r.trace.hnswTuning).toEqual(['SET LOCAL hnsw.ef_search = 100']);
    });

    it('iterativeScan bật + query CÓ filter → thêm SET LOCAL hnsw.iterative_scan', async () => {
      const { svc, executeRawUnsafe } = build({
        rows: [],
        hnsw: { efSearch: 80, iterativeScan: true },
      });
      await svc.retrieve({
        query: 'q',
        topK: 5,
        filters: { metadata: { source: 'x' } },
      });
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL hnsw.ef_search = 80',
      );
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL hnsw.iterative_scan = relaxed_order',
      );
    });

    it('iterativeScan bật nhưng query KHÔNG có filter → KHÔNG set iterative_scan', async () => {
      const { svc, executeRawUnsafe, transaction } = build({
        rows: [],
        hnsw: { iterativeScan: true },
      });
      await svc.retrieve({ query: 'q', topK: 5 });
      expect(transaction).not.toHaveBeenCalled();
      expect(executeRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
