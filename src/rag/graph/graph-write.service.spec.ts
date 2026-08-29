import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphCleanupService } from './graph-cleanup.service';
import { GraphWriteService } from './graph-write.service';
import type { ResolvedGraph } from './graph.types';

interface RunCall {
  cypher: string;
  params: Record<string, unknown>;
}

function build() {
  const calls: RunCall[] = [];
  const tx = {
    run: jest.fn((cypher: string, params: Record<string, unknown> = {}) => {
      calls.push({ cypher, params });
      return Promise.resolve({ records: [], summary: { counters: {} } });
    }),
  } as unknown as ManagedTransaction;

  const neo4j = {
    writeTx: jest.fn((work: (tx: ManagedTransaction) => Promise<unknown>) =>
      work(tx),
    ),
  } as unknown as Neo4jService;

  const cleanup = {
    removeDocumentInTx: jest.fn().mockResolvedValue({
      nodesDeleted: 0,
      relationshipsDeleted: 0,
    }),
  } as unknown as GraphCleanupService;

  return {
    svc: new GraphWriteService(neo4j, cleanup),
    calls,
    cleanup: cleanup.removeDocumentInTx as jest.Mock,
  };
}

const graph: ResolvedGraph = {
  documentId: 'd1',
  chunkIds: ['c1', 'c2'],
  entities: [
    { key: 'k1', name: 'A', type: 'ORG', description: 'x', chunkIds: ['c1'] },
    {
      key: 'k2',
      name: 'B',
      type: 'ORG',
      description: 'y',
      chunkIds: ['c1', 'c2'],
    },
  ],
  relationships: [
    {
      key: 'r1',
      sourceKey: 'k1',
      targetKey: 'k2',
      type: 'HOP_TAC',
      description: 'z',
      chunkIds: ['c1'],
    },
  ],
};

describe('GraphWriteService.replaceDocument', () => {
  it('cleanup trong CÙNG transaction rồi mới ghi', async () => {
    const { svc, calls, cleanup } = build();
    await svc.replaceDocument(graph);
    expect(cleanup).toHaveBeenCalledWith(expect.anything(), 'd1');
    // 4 câu ghi: chunks, entities, mentions, rels
    expect(calls).toHaveLength(4);
  });

  it('truyền đúng tham số: chunkIds, entities, mentions phẳng, rels', async () => {
    const { svc, calls } = build();
    await svc.replaceDocument(graph);

    const chunkCall = calls.find((c) => c.cypher.includes('MERGE (c:Chunk'))!;
    expect(chunkCall.params).toMatchObject({
      chunks: ['c1', 'c2'],
      docId: 'd1',
    });

    const mentionCall = calls.find((c) => c.cypher.includes('MENTIONED_IN'))!;
    expect(mentionCall.params.mentions).toEqual([
      { entityKey: 'k1', chunkId: 'c1' },
      { entityKey: 'k2', chunkId: 'c1' },
      { entityKey: 'k2', chunkId: 'c2' },
    ]);

    const relCall = calls.find((c) =>
      c.cypher.includes('MERGE (a)-[r:RELATED'),
    )!;
    expect((relCall.params.rels as unknown[])[0]).toMatchObject({
      key: 'r1',
      sourceKey: 'k1',
      targetKey: 'k2',
    });
  });

  it('đồ thị rỗng → vẫn cleanup (xoá graph cũ của doc), không ghi entity/quan hệ', async () => {
    const { svc, calls, cleanup } = build();
    await svc.replaceDocument({
      documentId: 'd1',
      chunkIds: [],
      entities: [],
      relationships: [],
    });
    expect(cleanup).toHaveBeenCalled();
    // chỉ câu MERGE Chunk (UNWIND rỗng, vô hại); không có entity/mention/rel
    expect(calls.every((c) => !c.cypher.includes(':Entity'))).toBe(true);
    expect(calls.every((c) => !c.cypher.includes('RELATED'))).toBe(true);
  });
});
