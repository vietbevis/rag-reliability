import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from '../../common/errors';
import { DatasetLoaderService } from './dataset-loader.service';

const validCase = {
  id: 'c1',
  type: 'DIRECT_RETRIEVAL',
  question: 'Câu hỏi thử?',
  answerable: true,
  expectedAnswer: 'Đáp án.',
  expectedDocuments: ['doc-a'],
  corpus: [{ title: 'T', source: 'doc-a', text: 'Nội dung tài liệu A.' }],
};

describe('DatasetLoaderService', () => {
  let dir: string;
  const prev = process.env.EVAL_DATASETS_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ds-loader-'));
    process.env.EVAL_DATASETS_DIR = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.EVAL_DATASETS_DIR = prev;
  });

  const writeLines = (name: string, objs: unknown[]) =>
    writeFileSync(
      join(dir, `${name}.jsonl`),
      objs
        .map((o) => (typeof o === 'string' ? o : JSON.stringify(o)))
        .join('\n') + '\n',
    );

  it('đọc + validate JSONL hợp lệ, áp default cho field vắng', () => {
    writeLines('ok', [
      validCase,
      {
        id: 'c2',
        type: 'UNANSWERABLE',
        question: 'Không trả lời được?',
        answerable: false,
        expectedAnswer: null,
        corpus: [{ title: 'T', source: 'doc-b', text: 'B.' }],
      },
    ]);
    const cases = new DatasetLoaderService().load('ok');
    expect(cases).toHaveLength(2);
    expect(cases[1]!.expectedDocuments).toEqual([]); // default
    expect(cases[1]!.expectedChunks).toEqual([]);
  });

  it('file không tồn tại -> ConfigError', () => {
    expect(() => new DatasetLoaderService().load('missing')).toThrow(
      ConfigError,
    );
  });

  it('JSON hỏng -> ConfigError kèm số dòng', () => {
    writeLines('bad', [JSON.stringify(validCase), '{not json']);
    expect(() => new DatasetLoaderService().load('bad')).toThrow(/dòng 2/);
  });

  it('vi phạm schema (answerable nhưng thiếu expectedAnswer) -> ConfigError', () => {
    writeLines('schema', [{ ...validCase, expectedAnswer: null }]);
    expect(() => new DatasetLoaderService().load('schema')).toThrow(
      ConfigError,
    );
  });

  it('expectedDocuments không nằm trong corpus.source -> ConfigError', () => {
    writeLines('gold', [{ ...validCase, expectedDocuments: ['doc-x'] }]);
    expect(() => new DatasetLoaderService().load('gold')).toThrow(ConfigError);
  });

  it('id trùng -> ConfigError', () => {
    writeLines('dup', [validCase, validCase]);
    expect(() => new DatasetLoaderService().load('dup')).toThrow(/id trùng/);
  });

  it('dataset rỗng -> ConfigError', () => {
    writeFileSync(join(dir, 'empty.jsonl'), '\n\n');
    expect(() => new DatasetLoaderService().load('empty')).toThrow(/rỗng/);
  });

  it('listDatasetNames trả tên file .jsonl đã sort', () => {
    writeLines('zeta', [validCase]);
    writeLines('alpha', [validCase]);
    expect(new DatasetLoaderService().listDatasetNames()).toEqual([
      'alpha',
      'zeta',
    ]);
  });
});
