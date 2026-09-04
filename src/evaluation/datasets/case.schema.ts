import { z } from 'zod';

/**
 * Schema cho một dòng golden dataset (`evaluation/datasets/*.jsonl`) — PROMPT
 * §31, §32 + mở rộng cho benchmark đa embedding / agent (xem
 * `docs/evaluation-dataset.md`). Mỗi case tự mang `corpus` (các tài liệu cần
 * ingest) để đánh giá độc lập, không phụ thuộc trạng thái DB trước đó.
 *
 * Nguyên tắc tương thích ngược: mọi field thêm sau PHASE 4 đều OPTIONAL và có
 * `.default(...)` — JSONL cũ (chỉ có id/type/question/answerable/expectedAnswer/
 * expectedDocuments/corpus) vẫn parse được.
 */

/** `type` = enum lưu vào cột `EvaluationCase.type` (Prisma). GIỮ NGUYÊN 7 giá trị. */
export const CaseTypeValues = [
  'DIRECT_RETRIEVAL',
  'MULTI_HOP',
  'UNANSWERABLE',
  'ADVERSARIAL',
  'CONFLICTING_SOURCES',
  'EXACT_IDENTIFIER',
  'SEMANTIC_QUERY',
] as const;

/**
 * `category` = phân loại mịn hơn `type`, dùng cho thống kê + chọn evaluator +
 * đọc báo cáo. Lưu trong `EvaluationCase.metadata.category` (không cần migration).
 */
export const CategoryValues = [
  'direct_retrieval',
  'semantic_paraphrase',
  'keyword_mismatch',
  'multi_hop',
  'cross_document',
  'numerical_exact',
  'temporal',
  'unanswerable',
  'false_premise',
  'entity_disambiguation',
  'vietnamese_robustness',
  'conflicting',
  'distractor',
  'long_context',
  'agent_routing',
] as const;

export const DifficultyValues = ['easy', 'medium', 'hard', 'expert'] as const;

/** Ngôn ngữ chủ đạo của câu hỏi (không phải của corpus). */
export const LanguageValues = ['vi', 'en', 'mixed'] as const;

/** Hành động agent kỳ vọng (PROMPT §18) — chỉ có nghĩa cho category `agent_routing`. */
export const ExpectedActionValues = ['rag', 'tool', 'rag_and_tool'] as const;

/** Phân loại câu hỏi negative (PROMPT §5). */
export const NegativeTypeValues = [
  'completely_unknown', // chủ đề hoàn toàn ngoài corpus
  'related_unsupported', // liên quan nhưng corpus không khẳng định
  'attribute_missing', // thực thể có nhưng thuộc tính hỏi thì không
  'similar_concept', // khái niệm gần giống, dễ trả nhầm
  'false_premise', // câu hỏi gài tiền đề sai
  'conflicting_premise', // tiền đề mâu thuẫn nội bộ
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
    /** Câu trả lời đúng khác được chấp nhận (LLM-judge / human) — PROMPT §2. */
    acceptableAnswers: z.array(z.string()).default([]),
    /** Tài liệu gold (mức `source`) — dùng tính recall/precision/MRR/nDCG. */
    expectedDocuments: z.array(z.string()).default([]),
    /** Tài liệu cũng có thể trả lời — không phạt nếu retrieval lấy cái này (PROMPT §10). */
    alternativeDocuments: z.array(z.string()).default([]),
    /** Chunk gold (mức id chunk nội bộ case) — hiện chưa dùng khi eval (chunk id sinh lúc ingest). */
    expectedChunks: z.array(z.string()).default([]),
    /** Tài liệu NHIỄU cố ý gần giống gold nhưng sai fact (PROMPT §15). */
    distractorDocuments: z.array(z.string()).default([]),
    /** Fact BẮT BUỘC phải xuất hiện trong câu trả lời đúng (PROMPT §11). */
    requiredFacts: z.array(z.string()).default([]),
    /** Khẳng định KHÔNG được phép có trong câu trả lời (PROMPT §12). */
    forbiddenClaims: z.array(z.string()).default([]),
    /** Case này hệ thống PHẢI abstain (không đủ thông tin). */
    shouldAbstain: z.boolean().default(false),
    category: z.enum(CategoryValues).optional(),
    difficulty: z.enum(DifficultyValues).default('medium'),
    /** Số bước suy luận / số chunk cần nối (PROMPT §9). */
    reasoningSteps: z.number().int().min(1).max(6).default(1),
    language: z.enum(LanguageValues).default('vi'),
    negativeType: z.enum(NegativeTypeValues).nullable().default(null),
    expectedAction: z.enum(ExpectedActionValues).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({}),
    corpus: z.array(corpusDocSchema).min(1),
  })
  .refine((c) => c.answerable === (c.expectedAnswer !== null), {
    message: 'answerable phải khớp với việc có expectedAnswer hay không',
  })
  .refine((c) => !c.answerable || !c.shouldAbstain, {
    message: 'answerable=true thì shouldAbstain phải false',
  })
  .refine((c) => corpusHasAll(c.corpus, c.expectedDocuments), {
    message: 'expectedDocuments phải nằm trong corpus.source',
  })
  .refine((c) => corpusHasAll(c.corpus, c.alternativeDocuments), {
    message: 'alternativeDocuments phải nằm trong corpus.source',
  })
  .refine((c) => corpusHasAll(c.corpus, c.distractorDocuments), {
    message: 'distractorDocuments phải nằm trong corpus.source',
  })
  .refine(
    (c) => c.distractorDocuments.every((s) => !c.expectedDocuments.includes(s)),
    { message: 'một source không thể vừa là gold vừa là distractor' },
  )
  .refine((c) => c.expectedAction === null || c.category === 'agent_routing', {
    message: 'expectedAction chỉ dùng cho category=agent_routing',
  });

function corpusHasAll(
  corpus: ReadonlyArray<{ source: string }>,
  sources: readonly string[],
): boolean {
  return sources.every((s) => corpus.some((d) => d.source === s));
}

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type CorpusDoc = z.infer<typeof corpusDocSchema>;
export type CaseCategory = (typeof CategoryValues)[number];
