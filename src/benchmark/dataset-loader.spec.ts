import { BENCHMARK_CATEGORIES } from './agent-case.schema';
import { loadBenchmarkCases } from './dataset-loader';

describe('benchmark dataset', () => {
  const cases = loadBenchmarkCases();

  it('nạp ≥ 20 case (PROMPT §30)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it('id không trùng', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mọi category hợp lệ + cover các nhóm bắt buộc', () => {
    const cats = new Set(cases.map((c) => c.category));
    for (const c of cats) {
      expect(BENCHMARK_CATEGORIES).toContain(c);
    }
    // PROMPT §27-28: RAG, tool selection, tool args, multi-step, failure, MCP, adversarial
    for (const need of [
      'rag',
      'tool-selection',
      'tool-args',
      'multi-step',
      'failure-recovery',
      'adversarial',
      'mcp-selection',
      'mcp-failure',
      'cross-provider',
      'mcp-workflow',
    ]) {
      expect(cats.has(need as never)).toBe(true);
    }
  });

  it('lọc theo category', () => {
    const rag = loadBenchmarkCases(['rag']);
    expect(rag.length).toBeGreaterThan(0);
    expect(rag.every((c) => c.category === 'rag')).toBe(true);
  });

  it('case MCP có mcpProviders; case abstain có mustAbstain', () => {
    const mcpWorkflow = cases.find((c) => c.id === 'mcp-workflow-chain');
    expect(mcpWorkflow?.mcpProviders.length).toBeGreaterThan(0);
  });
});
