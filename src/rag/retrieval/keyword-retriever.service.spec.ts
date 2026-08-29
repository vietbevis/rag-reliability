import { PrismaService } from '../../database/prisma.service';
import { KeywordRetrieverService } from './keyword-retriever.service';

function build(
  opts: {
    rows?: unknown[];
    queryRawThrows?: boolean;
  } = {},
) {
  const queryRaw = opts.queryRawThrows
    ? jest.fn().mockRejectedValue(new Error('DB connection failed'))
    : jest.fn().mockResolvedValue(opts.rows ?? []);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

  return {
    svc: new KeywordRetrieverService(prisma),
    queryRaw,
  };
}

const row = (id: string, rank: number) => ({
  id,
  documentId: 'd0',
  content: `chunk ${id}`,
  heading: 'Mục 1',
  section: 'Điều 1',
  page: 2,
  metadata: { strategy: 'fixed' },
  rank,
});

describe('KeywordRetrieverService', () => {
  it('map row -> RetrievedChunk, score ∈ [0,1] giảm theo rank, source="keyword"', async () => {
    const { svc, queryRaw } = build({
      rows: [row('a', 0.8), row('b', 0.2)],
    });
    const r = await svc.retrieve({ query: 'quy định học vụ', topK: 5 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0]!.chunkId).toBe('a');
    expect(r.chunks[0]!.documentId).toBe('d0');
    expect(r.chunks[0]!.content).toBe('chunk a');
    expect(r.chunks[0]!.source).toBe('keyword');
    expect(r.chunks[0]!.heading).toBe('Mục 1');
    expect(r.chunks[0]!.section).toBe('Điều 1');
    expect(r.chunks[0]!.page).toBe(2);
    expect(r.chunks[0]!.metadata).toEqual({ strategy: 'fixed', rank: 0.8 });

    // Score chuẩn hoá [0,1] theo BATCH (rank / maxRank) — top ≈ 1.0
    expect(r.chunks[0]!.score).toBe(1); // 0.8 / 0.8
    expect(r.chunks[1]!.score).toBeCloseTo(0.25, 4); // 0.2 / 0.8
    expect(r.chunks[0]!.score).toBeGreaterThan(r.chunks[1]!.score);

    expect(r.embeddingTokens).toBe(0);
    expect(r.estimatedCost).toBe(0);
    expect(r.trace.candidates).toBe(2);
    expect(r.trace.topScore).toBe(r.chunks[0]!.score);
  });

  it('truyền filters (documentIds, sources, metadata) vào query không ném', async () => {
    const { svc, queryRaw } = build({ rows: [] });
    const r = await svc.retrieve({
      query: 'Quyết định 123/QĐ-ĐHQG',
      topK: 3,
      filters: {
        documentIds: ['doc-1', 'doc-2'],
        sources: ['phòng ĐT'],
        metadata: { category: 'regulation' },
      },
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(r.chunks).toEqual([]);
    expect(r.trace.candidates).toBe(0);
    expect(r.trace.topScore).toBeNull();
  });

  it('0 kết quả -> chunks: [] (không ném)', async () => {
    const { svc, queryRaw } = build({ rows: [] });
    const r = await svc.retrieve({ query: 'từ khoá không tồn tại', topK: 5 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(r.chunks).toEqual([]);
    expect(r.trace.candidates).toBe(0);
    expect(r.trace.topScore).toBeNull();
  });

  it('query rỗng hoặc chỉ chứa ký tự đặc biệt -> emptyResult({ reason: "empty_tsquery" }) và không gọi DB', async () => {
    const { svc, queryRaw } = build({ rows: [] });

    const rEmpty = await svc.retrieve({ query: '', topK: 5 });
    expect(rEmpty.chunks).toEqual([]);
    expect(rEmpty.trace.reason).toBe('empty_tsquery');
    expect(queryRaw).not.toHaveBeenCalled();

    const rSpaces = await svc.retrieve({ query: '   ', topK: 5 });
    expect(rSpaces.chunks).toEqual([]);
    expect(rSpaces.trace.reason).toBe('empty_tsquery');
    expect(queryRaw).not.toHaveBeenCalled();

    const rSymbols = await svc.retrieve({
      query: '!@#$%^&*()_+-=[]{}|;:",.<>?/',
      topK: 5,
    });
    expect(rSymbols.chunks).toEqual([]);
    expect(rSymbols.trace.reason).toBe('empty_tsquery');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('lỗi DB -> KHÔNG ném (hợp đồng Retriever), trả trace.error', async () => {
    const { svc } = build({ queryRawThrows: true });
    const r = await svc.retrieve({ query: 'câu hỏi', topK: 5 });
    expect(r.chunks).toEqual([]);
    expect(r.trace.error).toBe('keyword_db_failed');
  });
});
