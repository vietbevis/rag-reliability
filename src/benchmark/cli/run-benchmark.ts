import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import {
  AgentBenchmarkRunner,
  type BenchmarkReport,
} from '../agent-benchmark.runner';
import {
  loadBenchmarkCases,
  RESULTS_DIR,
  BENCHMARK_DIR,
} from '../dataset-loader';
import {
  compareToBaseline,
  DEFAULT_THRESHOLDS,
  type RegressionThresholds,
} from '../regression';

/**
 * CLI benchmark agent (PROMPT §31, §37).
 *
 *   npm run benchmark:agent                  # chạy tất cả, so baseline, exit≠0 nếu regressed
 *   npm run benchmark:agent -- --case mcp-workflow   # lọc theo id/category
 *   npm run benchmark:agent -- --baseline            # lưu kết quả làm baseline
 *   npm run benchmark:agent -- --no-gate             # không exit≠0 khi regressed
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const filters = argv.filter((a) => !a.startsWith('--'));
  const caseIdx = argv.indexOf('--case');
  if (caseIdx >= 0 && argv[caseIdx + 1]) filters.push(argv[caseIdx + 1]!);

  const logger = new Logger('benchmark');
  mkdirSync(RESULTS_DIR, { recursive: true });

  const cases = loadBenchmarkCases(filters.length ? filters : undefined);
  if (cases.length === 0) {
    logger.error('Không có case nào khớp bộ lọc.');
    process.exit(1);
  }
  logger.log(`Chạy ${cases.length} case…`);

  process.env.AGENT_ENABLED = process.env.AGENT_ENABLED ?? 'true';
  process.env.QUEUE_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const runner = app.get(AgentBenchmarkRunner);
    const report = await runner.run(cases);

    const latestPath = join(RESULTS_DIR, 'latest.json');
    writeFileSync(latestPath, JSON.stringify(report, null, 2));
    logger.log(`→ ${latestPath}`);

    if (flags.has('--baseline')) {
      writeFileSync(
        join(RESULTS_DIR, 'baseline.json'),
        JSON.stringify(report, null, 2),
      );
      logger.log('→ baseline.json (đã chốt baseline mới)');

      // Gợi ý thresholds.json hiệu chỉnh theo baseline thực tế: gate trở thành
      // "regression detector" (baseline − margin) thay vì ngưỡng lý tưởng cứng.
      const m = report.metrics;
      const drop = DEFAULT_THRESHOLDS.maxAbsoluteDrop;
      const suggested = {
        _note:
          'Sinh từ --baseline. Ngưỡng = baseline − margin để bắt REGRESSION. ' +
          'Sửa tay khi chất lượng model cải thiện.',
        minTaskSuccess: round(m.taskSuccess - drop),
        minToolSelectionAccuracy: round(m.toolSelectionAccuracy - drop),
        minArgumentAccuracy: round(m.argumentAccuracy - drop),
        minGroundedness: round(m.groundedness - drop),
        minCitationAccuracy: round(m.citationAccuracy - drop),
        maxHallucinationRate: round(m.hallucinationRate + drop),
        minRecoveryRate: round(m.recoveryRate - drop),
        minSafetyRate: round(m.safetyRate - drop),
        maxLatencyMultiplier: DEFAULT_THRESHOLDS.maxLatencyMultiplier,
        maxAbsoluteDrop: drop,
      };
      const tPath = join(BENCHMARK_DIR, 'thresholds.suggested.json');
      writeFileSync(tPath, JSON.stringify(suggested, null, 2));
      logger.log(
        `→ ${tPath} — copy sang thresholds.json để bật gate hiệu chỉnh`,
      );
    }

    const baseline = loadReport(join(RESULTS_DIR, 'baseline.json'));
    const thresholds = loadThresholds();
    const cmp = compareToBaseline(report, baseline, thresholds);
    writeFileSync(join(RESULTS_DIR, 'diff.json'), JSON.stringify(cmp, null, 2));

    printSummary(report, logger);
    if (cmp.regressed) {
      logger.error('REGRESSION:');
      for (const r of cmp.reasons) logger.error(`  - ${r}`);
      if (!flags.has('--no-gate') && !flags.has('--baseline')) {
        await app.close();
        process.exit(1);
      }
    } else {
      logger.log('Không có regression.');
    }
  } finally {
    await app.close();
  }
}

function round(n: number): number {
  return Math.max(0, Math.round(n * 1e4) / 1e4);
}

function loadReport(path: string): BenchmarkReport | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as BenchmarkReport;
}

function loadThresholds(): RegressionThresholds {
  const path = join(BENCHMARK_DIR, 'thresholds.json');
  if (!existsSync(path)) return DEFAULT_THRESHOLDS;
  return {
    ...DEFAULT_THRESHOLDS,
    ...(JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<RegressionThresholds>),
  };
}

function printSummary(report: BenchmarkReport, logger: Logger): void {
  const m = report.metrics;
  logger.log(`— provider=${report.provider} model=${report.model}`);
  logger.log(
    `taskSuccess=${m.taskSuccess} avgScore=${m.avgScore} toolSel=${m.toolSelectionAccuracy} ` +
      `ground=${m.groundedness} halluc=${m.hallucinationRate} recovery=${m.recoveryRate} safety=${m.safetyRate}`,
  );
  logger.log(
    `avgSteps=${m.avgSteps} avgCalls=${m.avgToolCalls} avgLatency=${m.avgLatencyMs}ms tokens=${m.totalTokens}`,
  );
  for (const [cat, g] of Object.entries(report.byCategory)) {
    logger.log(`  ${cat}: ${g.passRate * 100}% pass (${g.count} case)`);
  }
  const failing = report.cases.filter((c) => !c.pass);
  if (failing.length) {
    logger.warn(`${failing.length} case FAIL:`);
    for (const c of failing) {
      logger.warn(
        `  ${c.id} [${c.category}] — ${c.failedHard.join(',')} · failure=${c.failureClass ?? '-'}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
