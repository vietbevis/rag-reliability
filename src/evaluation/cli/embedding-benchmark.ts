import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from '../../ai/embeddings/embedding.service';
import { ChunkEmbeddingService } from '../../rag/embedding/chunk-embedding.service';
import { DatasetLoaderService } from '../datasets/dataset-loader.service';
import { DatasetSeedService } from '../datasets/dataset-seed.service';
import { EvaluationService } from '../evaluation.service';

// Ingest corpus phải chạy inline trong CLI (không có BullMQ worker).
process.env.QUEUE_ENABLED = 'false';

/**
 * CLI benchmark ĐA EMBEDDING MODEL (PROMPT §16, §25).
 *
 *   npm run evaluate:embeddings                     # ma trận mặc định
 *   npm run evaluate:embeddings -- semantic golden  # chỉ định dataset
 *
 * Với mỗi entry của `evaluation/embedding-matrix.json`:
 *   1. đặt env (EMBEDDING_PROVIDER, model, dimension, prefix…),
 *   2. dựng Nest context mới (config đọc lại env),
 *   3. seed corpus của các dataset đích,
 *   4. TRUNCATE "Embedding" rồi re-embed toàn bộ chunk đã seed,
 *   5. chạy `evaluation.run({ mode: 'retrieval' })` — KHÔNG tốn LLM,
 *   6. gom recall@5 / precision@5 / mrr / ndcg@5 / contextRecall.
 *
 * Kết quả: `benchmarks/embedding/results/<label>.json` + `comparison.json`.
 *
 * LƯU Ý: cột pgvector cố định 1024 chiều — entry dimension ≠ 1024 sẽ lỗi khi
 * ghi vector (được bắt và bỏ qua). Sau khi chạy, embeddings trong DB là của
 * entry CUỐI CÙNG — chạy lại pipeline / `POST /documents/:id/embed` để khôi phục.
 */

interface MatrixEntry {
  label: string;
  description?: string;
  env: Record<string, string>;
}
interface Matrix {
  datasets: string[];
  entries: MatrixEntry[];
}

const METRIC_KEYS = [
  'recallAt5',
  'precisionAt5',
  'mrr',
  'ndcgAt5',
  'contextRecall',
  'avgLatencyMs',
] as const;

async function runEntry(
  entry: MatrixEntry,
  datasets: string[],
  logger: Logger,
): Promise<Record<string, Record<string, number | null>> | null> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(entry.env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const embeddings = app.get(EmbeddingService);
    if (!embeddings.isConfigured()) {
      logger.warn(
        `[${entry.label}] provider "${embeddings.activeProvider}" chưa cấu hình — BỎ QUA`,
      );
      return null;
    }
    logger.log(
      `[${entry.label}] provider=${embeddings.activeProvider} model=${embeddings.activeModel}`,
    );

    const loader = app.get(DatasetLoaderService);
    const seeder = app.get(DatasetSeedService);
    const prisma = app.get(PrismaService);
    const chunkEmbedding = app.get(ChunkEmbeddingService);
    const evaluation = app.get(EvaluationService);

    // Seed corpus mọi dataset đích -> tập documentId cần re-embed.
    const docIds = new Set<string>();
    for (const name of datasets) {
      const cases = loader.load(name);
      const seed = await seeder.seed(name, cases);
      for (const id of seed.sourceToDocId.values()) docIds.add(id);
    }

    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Embedding"');
    let embedded = 0;
    for (const id of docIds) {
      const r = await chunkEmbedding.embedDocument(id);
      if (r.error) {
        logger.error(`[${entry.label}] embed ${id} lỗi: ${r.error}`);
        return null;
      }
      if (!r.skipped) embedded += r.embeddedChunks ?? 0;
    }
    logger.log(
      `[${entry.label}] re-embed ${docIds.size} tài liệu (${embedded} chunk)`,
    );

    const out: Record<string, Record<string, number | null>> = {};
    for (const name of datasets) {
      const summary = await evaluation.run({
        datasetName: name,
        mode: 'retrieval',
        label: `emb-${entry.label}-${name}-${Date.now()}`,
      });
      out[name] = Object.fromEntries(
        METRIC_KEYS.map((k) => [k, summary.metrics[k] ?? null]),
      );
    }
    return out;
  } finally {
    await app.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
  const logger = new Logger('embedding-benchmark');
  const matrixPath = resolve(process.cwd(), 'evaluation/embedding-matrix.json');
  if (!existsSync(matrixPath)) {
    logger.error(`Không thấy ${matrixPath}`);
    process.exit(1);
  }
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as Matrix;
  const argDatasets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const datasets = argDatasets.length ? argDatasets : matrix.datasets;

  const resultsDir = resolve(process.cwd(), 'benchmarks/embedding/results');
  mkdirSync(resultsDir, { recursive: true });

  const byEntry: Record<
    string,
    Record<string, Record<string, number | null>>
  > = {};
  for (const entry of matrix.entries) {
    const res = await runEntry(entry, datasets, logger);
    if (!res) continue;
    byEntry[entry.label] = res;
    writeFileSync(
      join(resultsDir, `${entry.label}.json`),
      JSON.stringify({ label: entry.label, datasets: res }, null, 2),
    );
  }

  const labels = Object.keys(byEntry);
  if (labels.length === 0) {
    logger.error('Không entry nào chạy được (thiếu API key/URL?).');
    process.exit(1);
  }

  // Bảng so sánh: mỗi (dataset, metric) một dòng, mỗi entry một cột.
  const rows: Array<Record<string, string | number | null>> = [];
  for (const name of datasets) {
    for (const metric of METRIC_KEYS) {
      const row: Record<string, string | number | null> = {
        dataset: name,
        metric,
      };
      let best: { label: string; val: number } | null = null;
      for (const label of labels) {
        const v = byEntry[label]?.[name]?.[metric] ?? null;
        row[label] = v;
        if (v !== null && metric !== 'avgLatencyMs') {
          if (!best || v > best.val) best = { label, val: v };
        }
      }
      row.best = best?.label ?? '—';
      rows.push(row);
    }
  }
  writeFileSync(
    join(resultsDir, 'comparison.json'),
    JSON.stringify({ datasets, labels, rows }, null, 2),
  );
  console.log('\n=== ĐỐI SÁNH EMBEDDING MODEL (retrieval, K=5) ===');
  console.table(rows);
  console.log(`\n→ ${resultsDir}`);
  logger.warn(
    `Embeddings trong DB hiện là "${labels[labels.length - 1]}". Chạy lại pipeline / POST :id/embed để khôi phục.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
