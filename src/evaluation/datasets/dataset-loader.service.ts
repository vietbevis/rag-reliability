import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigError } from '../../common/errors';
import { evalCaseSchema, type EvalCase } from './case.schema';

/** Thư mục chứa dataset — override bằng env cho test/CI nếu cần. */
const DATASETS_DIR =
  process.env.EVAL_DATASETS_DIR ??
  resolve(process.cwd(), 'evaluation/datasets');

/**
 * Đọc golden dataset dạng JSONL, validate từng dòng bằng Zod. Tên dataset =
 * tên file không đuôi (vd `answerable`, `unanswerable`, `adversarial`,
 * `multi-hop`).
 */
@Injectable()
export class DatasetLoaderService {
  get datasetsDir(): string {
    return DATASETS_DIR;
  }

  listDatasetNames(): string[] {
    return readdirSync(DATASETS_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl$/, ''))
      .sort();
  }

  load(datasetName: string): EvalCase[] {
    const path = join(DATASETS_DIR, `${datasetName}.jsonl`);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new ConfigError(`Không tìm thấy dataset: ${path}`);
    }

    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const cases: EvalCase[] = [];
    const ids = new Set<string>();
    lines.forEach((line, i) => {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new ConfigError(`${datasetName}.jsonl dòng ${i + 1}: JSON hỏng`);
      }
      const parsed = evalCaseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ConfigError(
          `${datasetName}.jsonl dòng ${i + 1}: ${parsed.error.issues
            .map((x) => `${x.path.join('.')} ${x.message}`)
            .join('; ')}`,
        );
      }
      if (ids.has(parsed.data.id)) {
        throw new ConfigError(
          `${datasetName}.jsonl: id trùng "${parsed.data.id}"`,
        );
      }
      ids.add(parsed.data.id);
      cases.push(parsed.data);
    });

    if (cases.length === 0) {
      throw new ConfigError(`Dataset ${datasetName} rỗng`);
    }
    return cases;
  }
}
