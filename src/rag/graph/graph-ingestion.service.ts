import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { GraphError } from '../../common/errors';
import {
  DocumentStatus,
  IngestionStage,
  JobStatus,
} from '../../generated/prisma/client';
import { Neo4jService } from '../../graph/neo4j.service';
import { EntityExtractorService } from './entity-extractor.service';
import { GraphExtractionCacheService } from './graph-extraction-cache.service';
import { GraphWriteService } from './graph-write.service';
import { resolveGraph, type ChunkExtractionInput } from './entity-resolution';
import type { GraphIngestionResult } from './graph.types';

/** Trạng thái tài liệu được phép chạy graph construction. */
const GRAPHABLE: readonly DocumentStatus[] = [
  DocumentStatus.COMPLETED,
  DocumentStatus.GRAPHING,
];

/**
 * Điều phối Graph RAG construction cho MỘT tài liệu (graph-rag.md §3):
 *
 *   load chunk → (cache hit? dùng lại : extract + cache) → resolve
 *              → GraphWriteService.replaceDocument (cleanup + write, 1 tx Neo4j)
 *              → IngestionJob stage GRAPH + status COMPLETED
 *
 * - `GRAPH_RAG_ENABLED=false` → `{ skipped: true }`.
 * - Neo4j chết / extraction lỗi → KHÔNG ném ở nhánh auto (trả `{ skipped:false,
 *   reason }`, giữ tài liệu ở `GRAPHING` để chạy lại) — PROMPT §54. Nhánh
 *   explicit (`POST /documents/:id/graph`) truyền `throwOnError`.
 */
@Injectable()
export class GraphIngestionService {
  private readonly logger = new Logger(GraphIngestionService.name);
  private readonly extractCfg: AppConfig['graph']['extract'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
    private readonly extractor: EntityExtractorService,
    private readonly cache: GraphExtractionCacheService,
    private readonly writer: GraphWriteService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.extractCfg = config.get('graph', { infer: true }).extract;
  }

  get enabled(): boolean {
    return this.neo4j.enabled;
  }

  async ingest(
    documentId: string,
    opts: { throwOnError?: boolean } = {},
  ): Promise<GraphIngestionResult> {
    if (!this.neo4j.enabled) {
      return { documentId, skipped: true, reason: 'GRAPH_RAG_ENABLED=false' };
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true },
    });
    if (!doc)
      throw new NotFoundException(`Document ${documentId} không tồn tại`);
    if (!GRAPHABLE.includes(doc.status)) {
      throw new GraphError(
        'GRAPH_EXTRACTION_FAILED',
        `Document ở trạng thái ${doc.status}; phải embedding xong (COMPLETED/GRAPHING) trước khi dựng graph`,
      );
    }

    try {
      return await this.run(documentId);
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`Graph ingestion ${documentId} lỗi: ${reason}`);
      await this.prisma.ingestionJob
        .create({
          data: {
            documentId,
            stage: IngestionStage.GRAPH,
            status: JobStatus.FAILED,
            error: reason,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      if (opts.throwOnError) throw err;
      return { documentId, skipped: false, reason };
    }
  }

  private async run(documentId: string): Promise<GraphIngestionResult> {
    const t0 = Date.now();
    await this.setStatus(documentId, DocumentStatus.GRAPHING);

    // Khoá cache theo model THỰC dùng để trích (GRAPH_EXTRACT_MODEL nếu có),
    // không phải model chat chính.
    const model = this.extractor.model;
    const promptVersion = this.extractCfg.promptVersion;
    const perChunkCalls = 1 + this.extractCfg.gleanings;
    const callBudget = this.extractCfg.maxLlmCallsPerDoc;

    const allChunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { sequence: 'asc' },
      select: { id: true, content: true },
    });

    let cacheHits = 0;
    let failedChunks = 0;
    let llmCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let budgetHitAt = -1;
    // Đánh chỉ số theo vị trí chunk → giữ đúng thứ tự dù trích song song.
    const byIndex: Array<ChunkExtractionInput | undefined> = [];

    const extractOne = async (
      i: number,
      ck: { id: string; content: string },
      hash: string,
    ): Promise<void> => {
      const ext = await this.extractor.extract(ck.content);
      llmCalls += ext.llmCalls;
      inputTokens += ext.inputTokens;
      outputTokens += ext.outputTokens;
      estimatedCost += ext.estimatedCost;
      // Kết quả rỗng do lỗi schema KHÔNG được cache — nếu không, chunk này sẽ
      // mãi mãi "không có entity" dù lần chạy sau model trả đúng.
      if (ext.failed) {
        failedChunks++;
        return;
      }
      // Cache ngay từng chunk: một chunk khác trong đợt ném lỗi thì phần đã
      // trích xong vẫn được giữ cho lần chạy lại.
      await this.cache.put(hash, model, promptVersion, {
        entities: ext.entities,
        relationships: ext.relationships,
        inputTokens: ext.inputTokens,
        outputTokens: ext.outputTokens,
      });
      byIndex[i] = {
        chunkId: ck.id,
        entities: ext.entities,
        relationships: ext.relationships,
      };
    };

    // Pool ≤ GRAPH_EXTRACT_CONCURRENCY chunk chạy cùng lúc: chunk nào xong thì
    // nhường slot ngay cho chunk kế (không chờ chunk chậm nhất như chạy theo
    // đợt). concurrency=1 ⇒ hành vi tuần tự như cũ.
    // Promise trong `running` KHÔNG bao giờ reject: lỗi của chunk được ghi vào
    // `firstError` — nếu để reject, chunk lỗi ngay có thể rời pool trước khi
    // ai kịp await ⇒ lỗi bị nuốt, job "thành công" mà thiếu chunk.
    const running = new Set<Promise<void>>();
    let firstError: Error | undefined;
    const launch = (
      i: number,
      ck: { id: string; content: string },
      hash: string,
    ) => {
      const p: Promise<void> = extractOne(i, ck, hash)
        .catch((err: unknown) => {
          firstError ??= err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => {
          running.delete(p);
        });
      running.add(p);
    };

    for (let i = 0; i < allChunks.length; i++) {
      // Một chunk lỗi hạ tầng ⇒ ngừng khởi chạy chunk mới.
      if (firstError !== undefined) break;
      const ck = allChunks[i]!;
      const hash = this.cache.hash(ck.content);
      const cached = await this.cache.get(hash, model, promptVersion);
      if (cached) {
        cacheHits++;
        inputTokens += cached.inputTokens;
        outputTokens += cached.outputTokens;
        byIndex[i] = {
          chunkId: ck.id,
          entities: cached.entities,
          relationships: cached.relationships,
        };
        continue;
      }

      // Trần LLM tính theo lời gọi THẬT — cache hit không tốn budget. Chunk
      // đang chạy được giữ chỗ theo mức tối đa (1 + gleanings); chờ bớt chunk
      // đang chạy để biết số lời gọi thật rồi xét lại. Không còn chunk nào
      // chạy mà vẫn vượt trần ⇒ dừng.
      while (llmCalls + (running.size + 1) * perChunkCalls > callBudget) {
        if (running.size === 0) break;
        await Promise.race(running);
      }
      if (llmCalls + (running.size + 1) * perChunkCalls > callBudget) {
        budgetHitAt = i;
        break;
      }

      while (running.size >= this.extractCfg.concurrency) {
        await Promise.race(running);
      }
      if (firstError !== undefined) break;
      launch(i, ck, hash);
    }
    // Chờ mọi chunk đang chạy kết thúc (phần xong đã được cache) rồi mới ném
    // lỗi để job retry — lần sau các chunk đó là cache hit.
    await Promise.all(running);
    if (firstError !== undefined) throw firstError;

    const extractions = byIndex.filter(
      (e): e is ChunkExtractionInput => e !== undefined,
    );

    if (budgetHitAt >= 0) {
      this.logger.warn(
        `Document ${documentId}: đạt trần GRAPH_EXTRACT_MAX_LLM_CALLS_PER_DOC (${callBudget}) ` +
          `ở chunk ${budgetHitAt}/${allChunks.length} — ${allChunks.length - budgetHitAt} chunk sau chưa dựng graph (chạy lại sau khi cache đầy)`,
      );
    }

    const graph = resolveGraph(documentId, extractions);
    await this.writer.replaceDocument(graph);

    const metrics = {
      entityCount: graph.entities.length,
      relationshipCount: graph.relationships.length,
      chunkCount: extractions.length,
      chunkCountTotal: allChunks.length,
      llmCalls,
      cacheHits,
      failedChunks,
      inputTokens,
      outputTokens,
      estimatedCost: round(estimatedCost),
      ms: Date.now() - t0,
    };

    await this.prisma.$transaction([
      this.prisma.ingestionJob.create({
        data: {
          documentId,
          stage: IngestionStage.GRAPH,
          status: JobStatus.COMPLETED,
          startedAt: new Date(t0),
          finishedAt: new Date(),
          metrics,
        },
      }),
      this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.COMPLETED },
      }),
    ]);

    this.logger.log(
      `Graph ${documentId}: ${metrics.entityCount} entity, ${metrics.relationshipCount} quan hệ ` +
        `(${extractions.length}/${allChunks.length} chunk, ${llmCalls} LLM call, ${cacheHits} cache hit, ${failedChunks} chunk lỗi, $${metrics.estimatedCost})`,
    );
    return { documentId, skipped: false, metrics };
  }

  private async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.prisma.document.update({ where: { id }, data: { status } });
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
