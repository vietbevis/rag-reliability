import { z } from 'zod';

/**
 * Schema cho một dòng golden dataset (`evaluation/datasets/*.jsonl`) — PROMPT
 * §31, §32. Mỗi case tự mang `corpus` (các tài liệu cần ingest) để đánh giá
 * độc lập, không phụ thuộc trạng thái DB trước đó.
 */

export const CaseTypeValues = [
  'DIRECT_RETRIEVAL',
  'MULTI_HOP',
  'UNANSWERABLE',
  'ADVERSARIAL',
  'CONFLICTING_SOURCES',
  'EXACT_IDENTIFIER',
  'SEMANTIC_QUERY',
] as const;

export const corpusDocSchema = z.object({
  title: z.string().min(1),
  source: z.string().min(1),
  text: z.string().min(1),
});

export const evalCaseSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(CaseTypeValues),
    question: z.string().min(2),
    answerable: z.boolean(),
    expectedAnswer: z.string().nullable().default(null),
    expectedDocuments: z.array(z.string()).default([]),
    expectedChunks: z.array(z.string()).default([]),
    corpus: z.array(corpusDocSchema).min(1),
  })
  .refine((c) => c.answerable === (c.expectedAnswer !== null), {
    message: 'answerable phải khớp với việc có expectedAnswer hay không',
  })
  .refine(
    (c) =>
      c.expectedDocuments.every((s) => c.corpus.some((d) => d.source === s)),
    { message: 'expectedDocuments phải nằm trong corpus.source' },
  );

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type CorpusDoc = z.infer<typeof corpusDocSchema>;
