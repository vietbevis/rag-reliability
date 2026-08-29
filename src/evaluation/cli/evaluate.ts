import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { BenchmarkService } from '../benchmark.service';
import { DatasetLoaderService } from '../datasets/dataset-loader.service';
import { EvaluationService, type EvalMode } from '../evaluation.service';

/**
 * CLI đánh giá RAG (PROMPT §35-37).
 *
 *   npm run evaluate:retrieval                 # chỉ retrieval metrics, không gọi LLM
 *   npm run evaluate                           # eval đầy đủ + so baseline (exit≠0 nếu regression)
 *   npm run evaluate -- --baseline             # chốt các run này làm baseline
 *   npm run evaluate -- answerable multi-hop   # chỉ định dataset
 *   npm run evaluate -- answerable --label=exp-002   # đặt nhãn (1 dataset)
 *
 * Không truyền tên dataset => chạy mọi file `evaluation/datasets/*.jsonl`.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(
    argv.filter((a) => a.startsWith('--') && !a.includes('=')),
  );
  const datasetArgs = argv.filter((a) => !a.startsWith('--'));
  const labelArg = argv.find((a) => a.startsWith('--label='));

  const mode: EvalMode = flags.has('--retrieval') ? 'retrieval' : 'full';
  const isBaseline = flags.has('--baseline');
  const label = labelArg?.slice('--label='.length);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('evaluate');

  try {
    const loader = app.get(DatasetLoaderService);
    const evaluation = app.get(EvaluationService);
    const benchmark = app.get(BenchmarkService);

    const datasets = datasetArgs.length
      ? datasetArgs
      : loader.listDatasetNames();
    if (datasets.length === 0) {
      throw new Error(
        `Không có dataset nào trong ${loader.datasetsDir} (cần file *.jsonl)`,
      );
    }

    let regressed = false;
    for (const name of datasets) {
      logger.log(`▶ ${name} (mode=${mode})`);
      const summary = await evaluation.run({
        datasetName: name,
        mode,
        isBaseline,
        label: datasets.length === 1 ? label : undefined,
      });

      console.log(`\n=== ${name} — run ${summary.runId} ===`);
      console.log(`provider=${summary.provider} model=${summary.model}`);
      if (summary.notReadyCorpus.length) {
        console.log(
          `⚠ corpus chưa sẵn sàng: ${summary.notReadyCorpus.join(', ')}`,
        );
      }
      console.table(summary.metrics);

      if (!isBaseline) {
        const cmp = await benchmark.compareToBaseline(summary.runId);
        if (cmp.baselineRunId) {
          console.log(`\n--- so với baseline ${cmp.baselineRunId} ---`);
          console.table(
            cmp.deltas.filter((d) => d.delta !== null && d.delta !== 0),
          );
          if (cmp.regressed) {
            regressed = true;
            cmp.reasons.forEach((r) => logger.error(`REGRESSION: ${r}`));
          }
        } else {
          logger.warn(
            `Chưa có baseline cho "${name}" — chạy lại với --baseline`,
          );
        }
      }
    }

    await app.close();
    if (regressed) {
      logger.error('Có regression — FAIL');
      process.exit(1);
    }
    logger.log('Xong.');
    process.exit(0);
  } catch (err) {
    await app.close();
    logger.error((err as Error).stack ?? (err as Error).message);
    process.exit(1);
  }
}

void main();
