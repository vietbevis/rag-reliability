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
  } = {},
) {
  const queryRaw = jest.fn().mockResolvedValue(opts.rows ?? []);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

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

  const vectorSchema = {
    distanceOperator: opts.distance === 'l2' ? '<->' : '<=>',
  } as unknown as VectorSchemaService;

  const config = mockConfigService({
    embedding: { distance: opts.distance ?? 'cosine' },
  });

  return {
    svc: new VectorRetrieverService(prisma, embeddings, vectorSchema, config),
    queryRaw,
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
});
