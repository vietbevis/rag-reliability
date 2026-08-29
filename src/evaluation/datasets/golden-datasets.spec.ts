import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evalCaseSchema } from './case.schema';

/**
 * Kiểm tra tính hợp lệ của TOÀN BỘ golden dataset thật (evaluation/datasets/).
 * Bảo vệ khỏi hồi quy khi chỉnh scripts/gen-eval-datasets.mjs hoặc sửa tay JSONL.
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

describe('golden datasets (evaluation/datasets)', () => {
  it('có đủ 5 file dataset chuẩn', () => {
    expect(files).toEqual([
      'adversarial.jsonl',
      'answerable.jsonl',
      'conflicting.jsonl',
      'multi-hop.jsonl',
      'unanswerable.jsonl',
    ]);
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

  it('tổng số case >= 100 (đủ lực thống kê — EVALUATION_REVIEW §2)', () => {
    const total = files.reduce((n, f) => n + loadFile(f).length, 0);
    expect(total).toBeGreaterThanOrEqual(100);
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
});
