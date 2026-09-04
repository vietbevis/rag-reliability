#!/usr/bin/env node
/**
 * `npm run dataset:validate` — kiểm tra TOÀN BỘ golden dataset
 * (`evaluation/datasets/*.jsonl`) bằng schema Zod thật + các bất biến chất
 * lượng (PROMPT §21, §24). Exit ≠ 0 nếu có lỗi (dùng cho CI).
 *
 * Chạy qua `tsx` để import trực tiếp `case.schema.ts`.
 *
 * Kiểm tra:
 *  - schema từng dòng (id/type/question/answerable/corpus/… + field mở rộng)
 *  - id trùng trong 1 file và trên toàn bộ
 *  - question trùng / gần trùng (chuẩn hoá) — chống dup (§21)
 *  - leakage: question KHÔNG được chứa nguyên văn expectedAnswer (§21)
 *  - answerable=false ⇒ expectedDocuments rỗng, negativeType có giá trị
 *  - answerable=true ⇒ requiredFacts (nếu có) phải suy được từ corpus gold
 *  - multi_hop / cross_document ⇒ >= 2 tài liệu gold, reasoningSteps >= 2
 *  - distractor category ⇒ có distractorDocuments
 *  - conflicting ⇒ >= 2 tài liệu gold
 *  - agent_routing ⇒ có expectedAction
 *  - category hợp lệ, difficulty hợp lệ
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CategoryValues,
  evalCaseSchema,
} from '../src/evaluation/datasets/case.schema.ts';
import {
  factPresent,
  normalizeText,
} from '../src/evaluation/metrics/fact-metrics.ts';

const DIR = resolve(process.cwd(), 'evaluation/datasets');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort();

const errors = [];
const warnings = [];
const allIds = new Map(); // id -> file
const allQuestions = new Map(); // normalized question -> "file:id"

for (const file of files) {
  const lines = readFileSync(resolve(DIR, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const idsInFile = new Set();

  lines.forEach((line, i) => {
    const loc = `${file}:${i + 1}`;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      errors.push(`${loc}: JSON hỏng`);
      return;
    }
    const parsed = evalCaseSchema.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${loc}: ${issue.path.join('.')} — ${issue.message}`);
      }
      return;
    }
    const c = parsed.data;

    if (idsInFile.has(c.id)) errors.push(`${loc}: id trùng trong file "${c.id}"`);
    idsInFile.add(c.id);
    if (allIds.has(c.id)) {
      errors.push(`${loc}: id "${c.id}" trùng với ${allIds.get(c.id)}`);
    }
    allIds.set(c.id, loc);

    // golden.jsonl là regression pack — CỐ Ý tái dùng câu hỏi từ set khác.
    const qNorm = normalizeText(c.question);
    if (file !== 'golden.jsonl') {
      if (allQuestions.has(qNorm)) {
        errors.push(`${loc}: câu hỏi gần trùng với ${allQuestions.get(qNorm)}`);
      }
      allQuestions.set(qNorm, `${file}:${c.id}`);
    }

    // leakage
    if (
      c.expectedAnswer &&
      c.expectedAnswer.length > 12 &&
      normalizeText(c.question).includes(normalizeText(c.expectedAnswer))
    ) {
      errors.push(`${loc}: question chứa nguyên văn expectedAnswer (leakage)`);
    }

    // category
    if (c.category && !CategoryValues.includes(c.category)) {
      errors.push(`${loc}: category không hợp lệ "${c.category}"`);
    }
    if (!c.category) warnings.push(`${loc}: thiếu category`);

    const goldSources = new Set(c.expectedDocuments);
    const goldText = c.corpus
      .filter((d) => goldSources.has(d.source))
      .map((d) => d.text)
      .join('\n');

    // requiredFact phải suy được từ corpus gold — chỉ check cho category
    // "trích trực tiếp" (synthesis/temporal/conflicting có fact tổng hợp).
    const LITERAL_CATS = new Set([
      'direct_retrieval',
      'numerical_exact',
      'semantic_paraphrase',
      'keyword_mismatch',
      'long_context',
      'entity_disambiguation',
    ]);

    if (!c.answerable) {
      if (c.expectedDocuments.length > 0) {
        errors.push(`${loc}: answerable=false nhưng có expectedDocuments`);
      }
      if (!c.negativeType) warnings.push(`${loc}: negative case thiếu negativeType`);
      if (c.negativeType === 'false_premise' && c.forbiddenClaims.length === 0) {
        warnings.push(`${loc}: false_premise nên có forbiddenClaims (§12)`);
      }
    } else {
      if (c.expectedDocuments.length === 0 && c.category !== 'agent_routing') {
        errors.push(`${loc}: answerable=true nhưng không có expectedDocuments`);
      }
      if (LITERAL_CATS.has(c.category ?? '')) {
        for (const f of c.requiredFacts) {
          if (goldText && !factPresent(goldText, f)) {
            warnings.push(
              `${loc}: requiredFact "${f}" không thấy trong corpus gold`,
            );
          }
        }
      }
    }

    if (c.category === 'multi_hop' || c.category === 'cross_document') {
      if (c.reasoningSteps < 2) {
        errors.push(`${loc}: ${c.category} cần reasoningSteps >= 2`);
      }
      if (c.category === 'cross_document' && c.expectedDocuments.length < 2) {
        errors.push(`${loc}: cross_document cần >= 2 tài liệu gold`);
      }
      if (c.category === 'multi_hop' && c.expectedDocuments.length < 2) {
        warnings.push(`${loc}: multi_hop chỉ có 1 tài liệu gold (suy luận trong 1 văn bản?)`);
      }
    }
    if (
      c.answerable &&
      c.category === 'distractor' &&
      c.distractorDocuments.length === 0
    ) {
      warnings.push(`${loc}: distractor answerable nhưng thiếu distractorDocuments`);
    }
    if (c.type === 'CONFLICTING_SOURCES' && c.expectedDocuments.length < 2) {
      errors.push(`${loc}: CONFLICTING_SOURCES cần >= 2 tài liệu gold`);
    }
    if (c.category === 'agent_routing' && !c.expectedAction) {
      errors.push(`${loc}: agent_routing cần expectedAction`);
    }
  });
}

for (const w of warnings) console.warn(`⚠  ${w}`);
for (const e of errors) console.error(`✗  ${e}`);

console.log(
  `\n${files.length} file · ${allIds.size} case · ${errors.length} lỗi · ${warnings.length} cảnh báo`,
);
process.exit(errors.length > 0 ? 1 : 0);
