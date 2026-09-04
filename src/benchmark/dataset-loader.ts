import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentBenchmarkCaseSchema,
  type AgentBenchmarkCase,
} from './agent-case.schema';

export const BENCHMARK_DIR = join(process.cwd(), 'benchmarks', 'agent');
export const CASES_DIR = join(BENCHMARK_DIR, 'datasets');
export const RESULTS_DIR = join(BENCHMARK_DIR, 'results');

/**
 * Nạp case benchmark từ `benchmarks/agent/datasets/*.jsonl` (một case / dòng).
 * `only` = lọc theo id hoặc category.
 */
export function loadBenchmarkCases(only?: string[]): AgentBenchmarkCase[] {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.jsonl'));
  const cases: AgentBenchmarkCase[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const lines = readFileSync(join(CASES_DIR, file), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const [i, line] of lines.entries()) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new Error(`${file}:${i + 1} JSON không hợp lệ`);
      }
      const parsed = agentBenchmarkCaseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `${file}:${i + 1} case không hợp schema: ${parsed.error.issues
            .map((x) => `${x.path.join('.')}: ${x.message}`)
            .join('; ')}`,
        );
      }
      if (seen.has(parsed.data.id)) {
        throw new Error(`case id trùng: ${parsed.data.id}`);
      }
      seen.add(parsed.data.id);
      cases.push(parsed.data);
    }
  }

  if (!only || only.length === 0) return cases;
  const set = new Set(only);
  return cases.filter((c) => set.has(c.id) || set.has(c.category));
}
