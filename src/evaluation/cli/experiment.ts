import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import {
  ExperimentRunnerService,
  STANDARD_EXPERIMENTS,
} from '../experiments/experiment-runner.service';

/**
 * CLI chạy thực nghiệm RAG (PROMPT §36).
 *
 *   npm run evaluate:experiment -- exp-003                     # chạy 1 experiment
 *   npm run evaluate:experiment -- exp-003 --dataset=answerable # chỉ định dataset
 *   npm run evaluate:experiment -- --all                       # chạy toàn bộ suite
 *   npm run evaluate:experiment -- --list                      # liệt kê danh sách
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(
    argv.filter((a) => a.startsWith('--') && !a.includes('=')),
  );
  const positionalArgs = argv.filter((a) => !a.startsWith('--'));
  const datasetArg = argv.find((a) => a.startsWith('--dataset='));
  const datasetName = datasetArg?.slice('--dataset='.length);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('experiment');

  try {
    const runner = app.get(ExperimentRunnerService);

    if (flags.has('--list')) {
      console.log('\n=== DANH SÁCH EXPERIMENTS CHUẨN (PROMPT §36) ===');
      console.table(
        STANDARD_EXPERIMENTS.map((e) => ({
          ID: e.id,
          Name: e.name,
          Variable: e.variable,
          DefaultDataset: e.defaultDataset,
        })),
      );
      await app.close();
      process.exit(0);
    }

    const runAll = flags.has('--all');
    const targetExpId = positionalArgs[0] ?? (runAll ? undefined : 'exp-003');

    if (runAll) {
      logger.log('Chạy toàn bộ Experiment Suite...');
      const results = await runner.runAllExperiments({ datasetName });
      for (const res of results) {
        printExperimentResult(res);
      }
    } else if (targetExpId) {
      logger.log(`Chạy ${targetExpId}...`);
      const res = await runner.runExperiment(targetExpId, { datasetName });
      printExperimentResult(res);
    }

    await app.close();
    logger.log('Hoàn thành experiment.');
    process.exit(0);
  } catch (err) {
    await app.close();
    logger.error((err as Error).stack ?? (err as Error).message);
    process.exit(1);
  }
}

function printExperimentResult(res: {
  experiment: { id: string; name: string; hypothesis: string };
  comparison: {
    before: { runId: string; metrics: Record<string, number | null> };
    after: { runId: string; metrics: Record<string, number | null> };
    deltas: Array<{ metric: string; before: number | null; after: number | null; delta: number | null }>;
  };
}): void {
  console.log(`\n======================================================`);
  console.log(`EXPERIMENT ${res.experiment.id}: ${res.experiment.name}`);
  console.log(`Giả thuyết: ${res.experiment.hypothesis}`);
  console.log(`Before Run: ${res.comparison.before.runId} | After Run: ${res.comparison.after.runId}`);
  console.log(`------------------------------------------------------`);
  console.table(
    res.comparison.deltas.filter((d) => d.delta !== null && d.delta !== 0),
  );
}

void main();
