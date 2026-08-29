import { z } from 'zod';

/**
 * Schema structured-output cho extraction (graph-rag.md §3). LLM chỉ được trả
 * đúng hình dạng này; `schema.parse` phía server loại mọi thứ lệch (PROMPT §50).
 * Tên trường `entities` / `relationships` cố ý khớp heuristic của
 * `FakeLlmProvider` để CI chạy được không cần API key.
 *
 * Các trường "danh tính" (name/type/source/target) vẫn CHẶT — thiếu là dữ liệu
 * hỏng thật. Nhưng `strength` và `description` dùng `.catch(...)` thay vì ném:
 * qwen2.5:7b hay trả `strength` ngoài 1..10 hoặc description dài lê thê cho chunk
 * bảng, không đáng để hỏng cả job. `EntityExtractorService.postValidate`
 * (`clampStrength`, lọc entity không có trong văn bản) là lưới an toàn thật.
 * KHÔNG dùng `.transform()` ở đây — `FakeLlmProvider.fakeValueForSchema` không
 * introspect được qua pipe transform.
 */
export const extractedEntitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  description: z.string().max(600).catch(''),
});

export const extractedRelationshipSchema = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  description: z.string().max(600).catch(''),
  // Gợi ý 1..10; giá trị lạ (15, 100, "cao"...) → 5, rồi postValidate clamp lại.
  strength: z.number().catch(5),
});

export const graphExtractionSchema = z.object({
  entities: z.array(extractedEntitySchema).max(200).default([]),
  relationships: z.array(extractedRelationshipSchema).max(300).default([]),
});

export type GraphExtractionOutput = z.infer<typeof graphExtractionSchema>;
