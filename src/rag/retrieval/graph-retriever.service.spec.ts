import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { GraphError } from '../../common/errors';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphEntityLinkerService } from './graph-entity-linker.service';
import { GraphRetrieverService } from './graph-retriever.service';

function build(
  opts: {
    enabled?: boolean;
    seedKeys?: string[];
    relRows?: Array<{ chunkId: string; score: number }>;
    mentionRows?: Array<{ chunkId: string }>;
    pgRows?: unknown[];
    neo4jThrows?: boolean;
  } = {},
) {
  const read = jest.fn((cypher: string) => {
    if (opts.neo4jThrows) {
      return Promise.reject(new GraphError('GRAPH_UNAVAILABLE', 'down'));
    }
    if (cypher.includes('RELATED*1..')) {
      return Promise.resolve(opts.relRows ?? []);
    }
    return Promise.resolve(opts.mentionRows ?? []);
  });
  const neo4j = {
    enabled: opts.enabled ?? true,
    read,
  } as unknown as Neo4jService;

  const linker = {
    link: jest.fn().mockResolvedValue({
      seedKeys: opts.seedKeys ?? ['k1'],
      linkedNames: ['E1'],
      method: 'substring',
      usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    }),
  } as unknown as GraphEntityLinkerService;

  const queryRaw = jest.fn().mockResolvedValue(
    opts.pgRows ?? [
      {
        id: 'ch1',
        documentId: 'd0',
        content: 'nội dung 1',
        heading: null,
        section: 'Điều 1',
        page: null,
        metadata: {},
      },
    ],
  );
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

  const config = mockConfigService({
    graph: {
      retrieval: {
        maxHops: 2,
        maxEntityDegree: 200,
        topK: 10,
        linkUseLlm: true,
      },
    },
  });

  return {
    svc: new GraphRetrieverService(prisma, neo4j, linker, config),
    read,
    queryRaw,
    link: linker.link as jest.Mock,
  };
}

describe('GraphRetrieverService', () => {
  it('graph tắt → skipped, không gọi linker', async () => {
    const { svc, link } = build({ enabled: false });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks).toEqual([]);
    expect(r.trace.skipped).toBeDefined();
    expect(link).not.toHaveBeenCalled();
  });

  it('không seed entity → [] + reason no_seed_entity (KHÔNG error)', async () => {
    const { svc } = build({ seedKeys: [] });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks).toEqual([]);
    expect(r.trace.reason).toBe('no_seed_entity');
    expect(r.trace.error).toBeUndefined();
  });

  it('traversal → load chunk từ Postgres, score chuẩn hoá [0,1], source=graph', async () => {
    const { svc } = build({
      relRows: [
        { chunkId: 'ch1', score: 10 },
        { chunkId: 'ch2', score: 2 },
      ],
      pgRows: [
        {
          id: 'ch1',
          documentId: 'd0',
          content: 'a',
          heading: null,
          section: null,
          page: null,
          metadata: {},
        },
        {
          id: 'ch2',
          documentId: 'd0',
          content: 'b',
          heading: null,
          section: null,
          page: null,
          metadata: {},
        },
      ],
    });
    const r = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0]!.chunkId).toBe('ch1');
    expect(r.chunks[0]!.score).toBeGreaterThan(r.chunks[1]!.score);
    expect(r.chunks[0]!.score).toBeLessThanOrEqual(1);
    expect(r.chunks[0]!.source).toBe('graph');
    expect(r.chunks[0]!.metadata.graphPathScore).toBe(10);
  });

  it('Neo4j lỗi → [] + trace.error (KHÔNG ném), circuit mở sau 3 lỗi', async () => {
    const { svc } = build({ neo4jThrows: true });
    for (let i = 0; i < 3; i++) {
      const r = await svc.retrieve({ query: 'q', topK: 5 });
      expect(r.trace.error).toBe('graph_retrieval_failed');
    }
    // lần 4: circuit mở → skipped, không gọi Neo4j nữa
    const r4 = await svc.retrieve({ query: 'q', topK: 5 });
    expect(r4.trace.skipped).toBe('circuit_open');
  });
});
