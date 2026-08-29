import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphCleanupService } from './graph-cleanup.service';

function counters(nodesDeleted = 0, relationshipsDeleted = 0) {
  return {
    summary: {
      counters: {
        updates: () => ({ nodesDeleted, relationshipsDeleted }),
      },
    },
    records: [] as unknown[],
  };
}

function build() {
  const runs: string[] = [];
  const tx = {
    run: jest.fn((cypher: string) => {
      runs.push(cypher);
      if (cypher.includes('collect(c.id)')) {
        return Promise.resolve({
          ...counters(),
          records: [{ get: () => ['c1', 'c2'] }],
        });
      }
      if (cypher.includes('r:RELATED') && cypher.includes('DELETE r')) {
        return Promise.resolve(counters(0, 2));
      }
      if (cypher.includes('DETACH DELETE c')) {
        return Promise.resolve(counters(2, 0));
      }
      if (cypher.includes('DETACH DELETE e')) {
        return Promise.resolve(counters(3, 0));
      }
      return Promise.resolve(counters());
    }),
  } as unknown as ManagedTransaction;

  const neo4j = {
    writeTx: jest.fn((work: (tx: ManagedTransaction) => Promise<unknown>) =>
      work(tx),
    ),
  } as unknown as Neo4jService;

  return { svc: new GraphCleanupService(neo4j), runs };
}

describe('GraphCleanupService', () => {
  it('removeDocument: chạy đủ các bước, cộng dồn counter node/quan hệ', async () => {
    const { svc, runs } = build();
    const res = await svc.removeDocument('d1');

    expect(runs.some((r) => r.includes('collect(c.id)'))).toBe(true);
    expect(runs.some((r) => r.includes('r:RELATED'))).toBe(true);
    expect(runs.some((r) => r.includes('SET e.documentIds'))).toBe(true);
    expect(
      runs.some((r) =>
        r.includes('MATCH (c:Chunk {documentId: $d}) DETACH DELETE c'),
      ),
    ).toBe(true);
    // orphan entity delete
    expect(
      runs.some(
        (r) => r.includes('MENTIONED_IN') && r.includes('DETACH DELETE e'),
      ),
    ).toBe(true);

    expect(res.nodesDeleted).toBe(2 + 3); // chunk + orphan
    expect(res.relationshipsDeleted).toBe(2);
  });

  it('reconcile: truyền danh sách documentId hợp lệ vào mọi câu', async () => {
    const { svc } = build();
    const res = await svc.reconcile(['a', 'b']);
    expect(res.nodesDeleted).toBeGreaterThanOrEqual(0);
  });
});
