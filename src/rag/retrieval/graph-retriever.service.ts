import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import type { RetrievedChunk } from '../../common/types';
import { GraphError } from '../../common/errors';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphEntityLinkerService } from './graph-entity-linker.service';
import {
  emptyResult,
  type Retriever,
  type RetrieveOptions,
  type RetrieverResult,
} from './retriever.interface';

interface ChunkRow {
  id: string;
  documentId: string;
  content: string;
  heading: string | null;
  section: string | null;
  page: number | null;
  metadata: unknown;
}

/**
 * Truy hồi bằng **graph traversal cục bộ** (graph-rag.md §4):
 *
 *   query → entity linking (3 tầng) → seed `Entity.key`
 *         → traversal 1..maxHops (degree-cap, weight-sort, LIMIT)
 *         → union chunkId trên cạnh RELATED + MENTIONED_IN của seed
 *         → load chunk từ Postgres (áp filter) → RetrievedChunk[] source='graph'
 *
 * KHÔNG ném (hợp đồng `Retriever`): graph tắt / Neo4j chết / circuit mở / seed
 * rỗng → `chunks: []` + `trace` (RetrievalService quyết định có phải lỗi hạ tầng
 * toàn cục không — PROMPT §54).
 */
@Injectable()
export class GraphRetrieverService implements Retriever {
  readonly source = 'graph' as const;
  private readonly logger = new Logger(GraphRetrieverService.name);
  private readonly cfg: AppConfig['graph']['retrieval'];

  // Circuit-breaker nhẹ (graph-rag.md §0): N lỗi liên tiếp → tạm bỏ qua T ms.
  private static readonly FAIL_THRESHOLD = 3;
  private static readonly OPEN_MS = 30_000;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
    private readonly linker: GraphEntityLinkerService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('graph', { infer: true }).retrieval;
  }

  async retrieve(options: RetrieveOptions): Promise<RetrieverResult> {
    const started = Date.now();

    if (!this.neo4j.enabled) {
      return emptyResult({ skipped: 'GRAPH_RAG_ENABLED=false' });
    }
    if (Date.now() < this.openUntil) {
      return emptyResult({
        skipped: 'circuit_open',
        openUntil: this.openUntil,
      });
    }

    try {
      const link = await this.linker.link(options.query);

      // Neo4j chết ở bước linking = lỗi hạ tầng (KHÔNG phải "câu hỏi không có
      // thực thể"). Tính vào circuit-breaker, báo error (§54).
      if (link.error) {
        this.onFailure();
        return {
          ...emptyResult({
            error: 'graph_retrieval_failed',
            detail: link.error,
          }),
          estimatedCost: link.usage.estimatedCost,
          latencyMs: Date.now() - started,
        };
      }

      if (link.seedKeys.length === 0) {
        this.onSuccess();
        return {
          ...emptyResult({
            reason: 'no_seed_entity',
            linkMethod: link.method,
          }),
          estimatedCost: link.usage.estimatedCost,
          latencyMs: Date.now() - started,
        };
      }

      const scored = await this.traverse(link.seedKeys);
      const chunks = await this.loadChunks(scored, options);

      this.onSuccess();
      return {
        chunks: chunks.slice(0, options.topK),
        latencyMs: Date.now() - started,
        embeddingTokens: 0,
        estimatedCost: link.usage.estimatedCost,
        trace: {
          linkMethod: link.method,
          seedEntities: link.linkedNames,
          seedCount: link.seedKeys.length,
          hops: this.cfg.maxHops,
          chunkCandidates: scored.size,
        },
      };
    } catch (err) {
      this.onFailure();
      const code =
        err instanceof GraphError ? err.code : (err as Error).message;
      this.logger.warn(`Graph retrieval lỗi: ${code}`);
      return {
        ...emptyResult({ error: 'graph_retrieval_failed', detail: code }),
        latencyMs: Date.now() - started,
      };
    }
  }

  // --- traversal ----------------------------------------------------

  /** Trả về map chunkId → điểm thô (weight tích luỹ đường đi / mention). */
  private async traverse(seedKeys: string[]): Promise<Map<string, number>> {
    // `hops` / `topK` / `maxDegree` là int đã validate (env.schema) — nội suy
    // trực tiếp: LIMIT của Cypher CHỈ nhận integer literal/param-integer (param
    // number JS bị gửi thành float qua driver), KHÔNG phải user input.
    const hops = this.cfg.maxHops;
    const topK = this.cfg.topK;
    const maxDegree = this.cfg.maxEntityDegree;
    const scores = new Map<string, number>();

    const relRows = await this.neo4j.read<{ chunkId: string; score: number }>(
      `MATCH (s:Entity) WHERE s.key IN $seeds
       MATCH p = (s)-[:RELATED*1..${hops}]-(:Entity)
       WHERE all(x IN nodes(p) WHERE COUNT { (x)-[:RELATED]-() } <= ${maxDegree})
       WITH p, reduce(w = 0.0, r IN relationships(p) | w + coalesce(r.weight, 1.0)) AS pathScore
       ORDER BY pathScore DESC
       LIMIT ${topK}
       UNWIND relationships(p) AS r
       UNWIND coalesce(r.chunkIds, []) AS chunkId
       RETURN chunkId, max(pathScore) AS score`,
      { seeds: seedKeys },
    );
    for (const row of relRows) {
      scores.set(
        row.chunkId,
        Math.max(scores.get(row.chunkId) ?? 0, row.score),
      );
    }

    // Mention trực tiếp của seed — điểm nền (thấp hơn quan hệ).
    const mentionRows = await this.neo4j.read<{ chunkId: string }>(
      `MATCH (e:Entity) WHERE e.key IN $seeds
       MATCH (e)-[:MENTIONED_IN]->(c:Chunk)
       RETURN DISTINCT c.id AS chunkId
       LIMIT 200`,
      { seeds: seedKeys },
    );
    for (const row of mentionRows) {
      if (!scores.has(row.chunkId)) scores.set(row.chunkId, 0.5);
    }

    return scores;
  }

  // --- load + filter ----------------------------------------------

  private async loadChunks(
    scored: Map<string, number>,
    options: RetrieveOptions,
  ): Promise<RetrievedChunk[]> {
    if (scored.size === 0) return [];
    const ids = [...scored.keys()];
    const where = this.buildWhere(ids, options);

    const rows = await this.prisma.$queryRaw<ChunkRow[]>`
      SELECT c."id", c."documentId", c."content", c."heading", c."section",
             c."page", c."metadata"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${where}
    `;

    const maxScore = Math.max(...scored.values(), 1);
    return rows
      .map((r) => {
        const raw = scored.get(r.id) ?? 0;
        return {
          chunkId: r.id,
          documentId: r.documentId,
          content: r.content,
          // Chuẩn hoá [0,1]: tỉ lệ so với đường đi mạnh nhất trong batch.
          score: round(0.1 + 0.9 * (raw / maxScore)),
          source: 'graph' as const,
          heading: r.heading ?? undefined,
          section: r.section ?? undefined,
          page: r.page ?? undefined,
          metadata: {
            ...(r.metadata as Record<string, unknown>),
            graphPathScore: round(raw),
          },
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private buildWhere(chunkIds: string[], options: RetrieveOptions): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`c."id" IN (${Prisma.join(chunkIds)})`,
      Prisma.sql`d."status" = 'COMPLETED'::"DocumentStatus"`,
    ];
    const f = options.filters;
    if (f?.documentIds?.length) {
      parts.push(Prisma.sql`c."documentId" IN (${Prisma.join(f.documentIds)})`);
    }
    if (f?.sources?.length) {
      parts.push(Prisma.sql`d."source" IN (${Prisma.join(f.sources)})`);
    }
    for (const [key, value] of Object.entries(f?.metadata ?? {})) {
      parts.push(Prisma.sql`c."metadata" ->> ${key} = ${String(value)}`);
    }
    return Prisma.join(parts, ' AND ');
  }

  // --- circuit breaker -------------------------------------------

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= GraphRetrieverService.FAIL_THRESHOLD) {
      this.openUntil = Date.now() + GraphRetrieverService.OPEN_MS;
      this.logger.warn(
        `Graph retrieval circuit MỞ ${GraphRetrieverService.OPEN_MS}ms sau ${this.consecutiveFailures} lỗi liên tiếp`,
      );
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
