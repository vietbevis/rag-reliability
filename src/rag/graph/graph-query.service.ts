import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IngestionStage } from '../../generated/prisma/client';
import { Neo4jService } from '../../graph/neo4j.service';

export interface GraphDocSummary {
  enabled: boolean;
  documentId: string;
  entityCount: number;
  relationshipCount: number;
  topEntities: Array<{ name: string; type: string; mentions: number }>;
  lastRun: {
    status: string;
    metrics: unknown;
    finishedAt: Date | null;
    error: string | null;
  } | null;
}

/**
 * Tóm tắt phần graph của một tài liệu cho `GET /documents/:id/graph`
 * (graph-rag.md §3). Đọc count/top-entity từ Neo4j, lần chạy gần nhất từ
 * `IngestionJob` (Postgres).
 */
@Injectable()
export class GraphQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
  ) {}

  async summary(documentId: string): Promise<GraphDocSummary> {
    const lastJob = await this.prisma.ingestionJob.findFirst({
      where: { documentId, stage: IngestionStage.GRAPH },
      orderBy: { createdAt: 'desc' },
    });
    const lastRun = lastJob
      ? {
          status: lastJob.status,
          metrics: lastJob.metrics,
          finishedAt: lastJob.finishedAt,
          error: lastJob.error,
        }
      : null;

    if (!this.neo4j.enabled) {
      return {
        enabled: false,
        documentId,
        entityCount: 0,
        relationshipCount: 0,
        topEntities: [],
        lastRun,
      };
    }

    const [counts] = await this.neo4j.read<{
      entities: number;
      relationships: number;
    }>(
      `OPTIONAL MATCH (e:Entity) WHERE $d IN e.documentIds
       WITH count(e) AS entities
       OPTIONAL MATCH ()-[r:RELATED]->() WHERE $d IN r.documentIds
       RETURN entities, count(r) AS relationships`,
      { d: documentId },
    );

    const top = await this.neo4j.read<{
      name: string;
      type: string;
      mentions: number;
    }>(
      `MATCH (e:Entity) WHERE $d IN e.documentIds
       OPTIONAL MATCH (e)-[m:MENTIONED_IN]->(:Chunk {documentId: $d})
       RETURN e.name AS name, e.type AS type, count(m) AS mentions
       ORDER BY mentions DESC, name ASC
       LIMIT 10`,
      { d: documentId },
    );

    return {
      enabled: true,
      documentId,
      entityCount: counts?.entities ?? 0,
      relationshipCount: counts?.relationships ?? 0,
      topEntities: top.map((t) => ({
        name: t.name,
        type: t.type,
        mentions: t.mentions,
      })),
      lastRun,
    };
  }
}
