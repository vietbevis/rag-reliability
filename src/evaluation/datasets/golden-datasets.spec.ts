import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CategoryValues, evalCaseSchema } from './case.schema';

/**
 * Kiểm tra tính hợp lệ của TOÀN BỘ golden dataset thật (evaluation/datasets/).
 * Bảo vệ khỏi hồi quy khi chỉnh `scripts/gen-eval-datasets*.mjs` hoặc sửa tay
 * JSONL. Kiểm tra sâu hơn nằm ở `npm run dataset:validate`.
 */
const DIR = resolve(process.cwd(), 'evaluation/datasets');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort();

function loadFile(file: string) {
  return readFileSync(resolve(DIR, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => evalCaseSchema.parse(JSON.parse(line)));
}

const EXPECTED_FILES = [
  'adversarial.jsonl',
  'agent-routing.jsonl',
  'answerable.jsonl',
  'conflicting.jsonl',
  'cross-document.jsonl',
  'distractor.jsonl',
  'entity-disambiguation.jsonl',
  'golden.jsonl',
  'multi-hop.jsonl',
  'numerical.jsonl',
  'semantic.jsonl',
  'unanswerable.jsonl',
  'vietnamese-robustness.jsonl',
];

describe('golden datasets (evaluation/datasets)', () => {
  it('có đủ 13 file dataset chuẩn', () => {
    expect(files).toEqual(EXPECTED_FILES);
  });

  it.each(files)('%s: mọi dòng khớp schema, không trùng id', (file) => {
    const cases = loadFile(file);
    expect(cases.length).toBeGreaterThan(0);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
  });

  it('id là duy nhất trên toàn bộ dataset', () => {
    const ids = files.flatMap((f) => loadFile(f).map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tổng số case >= 200 (đủ lực thống kê — EVALUATION_REVIEW §2)', () => {
    const total = files.reduce((n, f) => n + loadFile(f).length, 0);
    expect(total).toBeGreaterThanOrEqual(200);
  });

  it('adversarial + unanswerable đều là answerable=false', () => {
    for (const file of ['adversarial.jsonl', 'unanswerable.jsonl']) {
      for (const c of loadFile(file)) expect(c.answerable).toBe(false);
    }
  });

  it('conflicting: mỗi case trích ít nhất 2 tài liệu gold', () => {
    for (const c of loadFile('conflicting.jsonl')) {
      expect(c.expectedDocuments.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('cross-document: >= 2 tài liệu gold + reasoningSteps >= 2', () => {
    for (const c of loadFile('cross-document.jsonl')) {
      expect(c.expectedDocuments.length).toBeGreaterThanOrEqual(2);
      expect(c.reasoningSteps).toBeGreaterThanOrEqual(2);
    }
  });

  it('distractor: mỗi case answerable có distractorDocuments', () => {
    for (const c of loadFile('distractor.jsonl')) {
      if (c.answerable && c.category === 'distractor') {
        expect(c.distractorDocuments.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('agent-routing: mọi case có expectedAction hợp lệ', () => {
    for (const c of loadFile('agent-routing.jsonl')) {
      expect(['rag', 'tool', 'rag_and_tool']).toContain(c.expectedAction);
    }
  });

  it('mọi case đều có category hợp lệ', () => {
    for (const f of files) {
      for (const c of loadFile(f)) {
        expect(c.category).toBeDefined();
        expect(CategoryValues).toContain(c.category);
      }
    }
  });

  it('answerable=false ⇒ không có expectedDocuments, có negativeType', () => {
    for (const f of files) {
      for (const c of loadFile(f)) {
        if (!c.answerable) {
          expect(c.expectedDocuments).toEqual([]);
          expect(c.negativeType).not.toBeNull();
        }
      }
    }
  });

  it('golden: là regression pack, >= 20 case, đủ độ khó & category đa dạng', () => {
    const g = loadFile('golden.jsonl');
    expect(g.length).toBeGreaterThanOrEqual(20);
    const cats = new Set(g.map((c) => c.category));
    expect(cats.size).toBeGreaterThanOrEqual(8);
    expect(g.some((c) => !c.answerable)).toBe(true);
    expect(
      g.some((c) => c.difficulty === 'hard' || c.difficulty === 'expert'),
    ).toBe(true);
  });
});
