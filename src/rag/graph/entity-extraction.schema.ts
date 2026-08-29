import { z } from 'zod';

/**
 * Schema structured-output cho extraction (graph-rag.md §3). LLM chỉ được trả
 * đúng hình dạng này; `schema.parse` phía server loại mọi thứ lệch (PROMPT §50).
 * Tên trường `entities` / `relationships` cố ý khớp heuristic của
 * `FakeLlmProvider` để CI chạy được không cần API key.
 */
export const extractedEntitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  description: z.string().max(600).default(''),
});

export const extractedRelationshipSchema = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  description: z.string().max(600).default(''),
  strength: z.number().min(1).max(10).default(5),
});

export const graphExtractionSchema = z.object({
  entities: z.array(extractedEntitySchema).max(100).default([]),
  relationships: z.array(extractedRelationshipSchema).max(200).default([]),
});

export type GraphExtractionOutput = z.infer<typeof graphExtractionSchema>;
