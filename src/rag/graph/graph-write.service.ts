import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphCleanupService } from './graph-cleanup.service';
import type { ResolvedGraph } from './graph.types';

/**
 * Thay thế toàn bộ phần graph của MỘT tài liệu: cleanup phần cũ + ghi phần mới
 * bằng `UNWIND` batch MERGE, TẤT CẢ trong MỘT giao dịch ghi có quản lý (tự retry
 * transient) — graph-rag.md §3.
 *
 * Vì cleanup + write nằm trong cùng transaction, re-ingest song song cùng một
 * tài liệu vẫn nhất quán (Neo4j serialize theo write-lock trên node liên quan;
 * người ghi cuối thắng, mỗi lần đều cleanup + write đầy đủ).
 */
@Injectable()
export class GraphWriteService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly cleanup: GraphCleanupService,
  ) {}

  async replaceDocument(graph: ResolvedGraph): Promise<void> {
    const mentions = graph.entities.flatMap((e) =>
      e.chunkIds.map((chunkId) => ({ entityKey: e.key, chunkId })),
    );

    await this.neo4j.writeTx(async (tx) => {
      await this.cleanup.removeDocumentInTx(tx, graph.documentId);

      await tx.run(
        `UNWIND $chunks AS ckId
         MERGE (c:Chunk {id: ckId})
         SET c.documentId = $docId`,
        { chunks: graph.chunkIds, docId: graph.documentId },
      );

      if (graph.entities.length) {
        await tx.run(
          `UNWIND $entities AS en
           MERGE (e:Entity {key: en.key})
             ON CREATE SET e.name = en.name, e.type = en.type,
                           e.description = en.description,
                           e.documentIds = [$docId]
             ON MATCH SET e.name = coalesce(e.name, en.name),
                          e.type = coalesce(e.type, en.type),
                          e.description = CASE
                            WHEN size(coalesce(e.description, '')) >= size(en.description)
                            THEN e.description ELSE en.description END,
                          e.documentIds = CASE
                            WHEN $docId IN coalesce(e.documentIds, [])
                            THEN e.documentIds ELSE coalesce(e.documentIds, []) + $docId END`,
          { entities: graph.entities, docId: graph.documentId },
        );
      }

      if (mentions.length) {
        await tx.run(
          `UNWIND $mentions AS m
           MATCH (e:Entity {key: m.entityKey})
           MATCH (c:Chunk {id: m.chunkId})
           MERGE (e)-[:MENTIONED_IN]->(c)`,
          { mentions },
        );
      }

      if (graph.relationships.length) {
        await tx.run(
          `UNWIND $rels AS rel
           MATCH (a:Entity {key: rel.sourceKey})
           MATCH (b:Entity {key: rel.targetKey})
           MERGE (a)-[r:RELATED {key: rel.key}]->(b)
             ON CREATE SET r.type = rel.type, r.description = rel.description,
                           r.chunkIds = rel.chunkIds, r.documentIds = [$docId],
                           r.weight = size(rel.chunkIds)
             ON MATCH SET r.chunkIds =
                            r.chunkIds + [x IN rel.chunkIds WHERE NOT x IN r.chunkIds],
                          r.documentIds = CASE
                            WHEN $docId IN r.documentIds
                            THEN r.documentIds ELSE r.documentIds + $docId END,
                          r.description = CASE
                            WHEN size(coalesce(r.description, '')) >= size(rel.description)
                            THEN r.description ELSE rel.description END,
                          r.weight =
                            size(r.chunkIds + [x IN rel.chunkIds WHERE NOT x IN r.chunkIds])`,
          { rels: graph.relationships, docId: graph.documentId },
        );
      }
    });
  }
}
