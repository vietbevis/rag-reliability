#!/usr/bin/env node
/**
 * `npm run dataset:stats` — in thống kê phân bố của golden dataset
 * (`evaluation/datasets/*.jsonl`): tổng số, theo file / category / type /
 * difficulty / ngôn ngữ, answerable vs abstain, multi-hop, số chunk gold trung
 * bình, agent routing, coverage requiredFacts/forbiddenClaims (PROMPT §24).
 *
 * Chạy qua `tsx` để dùng schema Zod thật (áp default cho field vắng).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evalCaseSchema } from '../src/evaluation/datasets/case.schema.ts';

const DIR = resolve(process.cwd(), 'evaluation/datasets');
const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort();

/** @type {Array<{file:string, c: import('../src/evaluation/datasets/case.schema.ts').EvalCase}>} */
const all = [];
for (const file of files) {
  const lines = readFileSync(resolve(DIR, file), 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    all.push({ file, c: evalCaseSchema.parse(JSON.parse(line)) });
  }
}

const cases = all.map((x) => x.c);
const tally = (fn) => {
  const m = new Map();
  for (const c of cases) {
    const k = String(fn(c) ?? '(none)');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const printTable = (title, rows) => {
  console.log(`\n${title}`);
  const w = Math.max(...rows.map(([k]) => k.length), 8);
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(w)}  ${String(v).padStart(4)}  ${'█'.repeat(Math.round(v / 2))}`);
  }
};

console.log(`# THỐNG KÊ GOLDEN DATASET (evaluation/datasets)\n`);
console.log(`Tổng số case:        ${cases.length}`);
console.log(`Số file:             ${files.length}`);
console.log(`Answerable:          ${cases.filter((c) => c.answerable).length}`);
console.log(`Unanswerable/abstain:${cases.filter((c) => !c.answerable).length}`);
console.log(`shouldAbstain=true:  ${cases.filter((c) => c.shouldAbstain).length}`);

const mh = cases.filter((c) => c.reasoningSteps >= 2);
console.log(`Multi-step (>=2 bước): ${mh.length}`);
const goldDocs = cases.filter((c) => c.expectedDocuments.length > 0);
const avgGold = goldDocs.length
  ? (goldDocs.reduce((s, c) => s + c.expectedDocuments.length, 0) / goldDocs.length).toFixed(2)
  : '0';
console.log(`Số tài liệu gold TB (case answerable): ${avgGold}`);
console.log(`Case có distractorDocuments: ${cases.filter((c) => c.distractorDocuments.length).length}`);
console.log(`Case có requiredFacts:       ${cases.filter((c) => c.requiredFacts.length).length}`);
console.log(`Case có forbiddenClaims:     ${cases.filter((c) => c.forbiddenClaims.length).length}`);
console.log(`Agent routing:              ${cases.filter((c) => c.category === 'agent_routing').length}`);

printTable('THEO FILE', files.map((f) => [f.replace(/\.jsonl$/, ''), all.filter((x) => x.file === f).length]));
printTable('THEO CATEGORY', tally((c) => c.category));
printTable('THEO TYPE', tally((c) => c.type));
printTable('THEO DIFFICULTY', tally((c) => c.difficulty));
printTable('THEO NGÔN NGỮ', tally((c) => c.language));
printTable('THEO reasoningSteps', tally((c) => c.reasoningSteps));
printTable('THEO negativeType (negative)', tally((c) => (c.answerable ? null : c.negativeType)).filter(([k]) => k !== '(none)'));
printTable('THEO expectedAction (agent_routing)', tally((c) => c.expectedAction).filter(([k]) => k !== '(none)'));

// corpus
const corpusSet = new Set();
for (const c of cases) for (const d of c.corpus) corpusSet.add(d.source);
console.log(`\nTổng tài liệu corpus khác nhau: ${corpusSet.size}`);
