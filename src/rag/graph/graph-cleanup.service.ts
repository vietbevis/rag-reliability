import { Injectable, Logger } from '@nestjs/common';
import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from '../../graph/neo4j.service';

export interface CleanupResult {
  nodesDeleted: number;
  relationshipsDeleted: number;
}

interface Counters {
  nodesDeleted: number;
  relationshipsDeleted: number;
}

/**
 * Dọn phần graph của một tài liệu (graph-rag.md §3). Chạy TRƯỚC khi re-graph
 * (idempotent) và khi xoá tài liệu. Prisma không cascade sang Neo4j nên MỌI
 * đường xoá document phải đi qua đây.
 *
 * `removeDocumentInTx` được `GraphWriteService` tái dùng để cleanup + write nằm
 * TRONG CÙNG một giao dịch Neo4j → re-ingest song song vẫn nhất quán (Neo4j
 * serialize theo write-lock trên node liên quan).
 */
@Injectable()
export class GraphCleanupService {
  private readonly logger = new Logger(GraphCleanupService.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /** Cleanup trong một transaction có sẵn. Trả về số node/cạnh đã xoá. */
  async removeDocumentInTx(
    tx: ManagedTransaction,
    documentId: string,
  ): Promise<CleanupResult> {
    let nodesDeleted = 0;
    let relationshipsDeleted = 0;
    const tally = (c: Counters): void => {
      nodesDeleted += c.nodesDeleted;
      relationshipsDeleted += c.relationshipsDeleted;
    };

    const ckRows = await tx.run<{ ckIds: string[] }>(
      `MATCH (c:Chunk {documentId: $d}) RETURN collect(c.id) AS ckIds`,
      { d: documentId },
    );
    const ckIds = ckRows.records[0]?.get('ckIds') ?? [];

    // 1. RELATED: bỏ documentId + chunkId của tài liệu; xoá cạnh nếu cạn.
    // `weight` tính từ biểu thức lọc inline (không đọc r.chunkIds "cũ").
    const rel = await tx.run(
      `MATCH ()-[r:RELATED]->() WHERE $d IN r.documentIds
       SET r.documentIds = [x IN r.documentIds WHERE x <> $d],
           r.chunkIds = [x IN coalesce(r.chunkIds, []) WHERE NOT x IN $ckIds],
           r.weight = size([x IN coalesce(r.chunkIds, []) WHERE NOT x IN $ckIds])
       WITH r WHERE size(r.documentIds) = 0 OR size(r.chunkIds) = 0
       DELETE r`,
      { d: documentId, ckIds },
    );
    tally(rel.summary.counters.updates());

    // 2. Entity: bỏ documentId của tài liệu khỏi tập.
    await tx.run(
      `MATCH (e:Entity) WHERE $d IN e.documentIds
       SET e.documentIds = [x IN e.documentIds WHERE x <> $d]`,
      { d: documentId },
    );

    // 3. Xoá Chunk của tài liệu (kéo theo mọi MENTIONED_IN trỏ vào).
    const chunk = await tx.run(
      `MATCH (c:Chunk {documentId: $d}) DETACH DELETE c`,
      { d: documentId },
    );
    tally(chunk.summary.counters.updates());

    // 4. Xoá Entity mồ côi (không còn tài liệu & không còn MENTIONED_IN).
    const orphan = await tx.run(
      `MATCH (e:Entity)
       WHERE size(coalesce(e.documentIds, [])) = 0
         AND NOT (e)-[:MENTIONED_IN]->(:Chunk)
       DETACH DELETE e`,
    );
    tally(orphan.summary.counters.updates());

    return { nodesDeleted, relationshipsDeleted };
  }

  async removeDocument(documentId: string): Promise<CleanupResult> {
    return this.neo4j.writeTx((tx) => this.removeDocumentInTx(tx, documentId));
  }

  /**
   * Đối soát toàn bộ graph với danh sách documentId hợp lệ từ Postgres
   * (graph-rag.md §0). Xoá mọi node/cạnh trỏ tới tài liệu không còn tồn tại.
   */
  async reconcile(validDocumentIds: string[]): Promise<CleanupResult> {
    const valid = validDocumentIds;
    const result = await this.neo4j.writeTx(async (tx) => {
      let nodesDeleted = 0;
      let relationshipsDeleted = 0;
      const tally = (c: Counters): void => {
        nodesDeleted += c.nodesDeleted;
        relationshipsDeleted += c.relationshipsDeleted;
      };

      const chunk = await tx.run(
        `MATCH (c:Chunk) WHERE NOT c.documentId IN $valid DETACH DELETE c`,
        { valid },
      );
      tally(chunk.summary.counters.updates());

      // Danh sách chunkId còn sống (sau khi đã xoá chunk mồ côi ở trên) —
      // để lọc r.chunkIds của cạnh RELATED chia sẻ nhiều tài liệu.
      const liveChunks = await tx.run<{ ids: string[] }>(
        `MATCH (c:Chunk) RETURN collect(c.id) AS ids`,
      );
      const validChunkIds = liveChunks.records[0]?.get('ids') ?? [];

      await tx.run(
        `MATCH (e:Entity)
         SET e.documentIds = [x IN coalesce(e.documentIds, []) WHERE x IN $valid]`,
        { valid },
      );
      const rel = await tx.run(
        `MATCH ()-[r:RELATED]->()
         SET r.documentIds = [x IN coalesce(r.documentIds, []) WHERE x IN $valid],
             r.chunkIds = [x IN coalesce(r.chunkIds, []) WHERE x IN $validChunkIds],
             r.weight = size([x IN coalesce(r.chunkIds, []) WHERE x IN $validChunkIds])
         WITH r WHERE size(r.documentIds) = 0 OR size(r.chunkIds) = 0
         DELETE r`,
        { valid, validChunkIds },
      );
      tally(rel.summary.counters.updates());

      const orphan = await tx.run(
        `MATCH (e:Entity)
         WHERE size(coalesce(e.documentIds, [])) = 0
           AND NOT (e)-[:MENTIONED_IN]->(:Chunk)
         DETACH DELETE e`,
      );
      tally(orphan.summary.counters.updates());

      return { nodesDeleted, relationshipsDeleted };
    });

    if (result.nodesDeleted || result.relationshipsDeleted) {
      this.logger.warn(
        `Reconcile dọn: ${result.nodesDeleted} node, ${result.relationshipsDeleted} quan hệ mồ côi`,
      );
    }
    return result;
  }
}
