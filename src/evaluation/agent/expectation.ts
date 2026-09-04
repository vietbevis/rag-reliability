import { z } from 'zod';

/**
 * Kỳ vọng cho một agent case (PROMPT §25). **KHÔNG** ép một trajectory đúng duy
 * nhất — dùng tập chấp nhận / cấm / ràng buộc thay vì
 * `expected_exact_tool_sequence`.
 */
export const argConstraintSchema = z.object({
  /** Đường dẫn tới field trong args (JSONPath đơn giản: `a.b`). */
  path: z.string(),
  /** Regex mà giá trị (đã stringify) phải khớp. */
  matches: z.string().optional(),
  /** Giá trị phải nằm trong tập này. */
  oneOf: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Field bắt buộc phải xuất hiện. */
  required: z.boolean().optional(),
});

export const agentExpectationSchema = z.object({
  expectedAnswer: z.string().nullable().default(null),
  /** Tool NÊN được dùng (tập, không xét thứ tự). */
  acceptableTools: z.array(z.string()).optional(),
  /** Tool KHÔNG được dùng. */
  forbiddenTools: z.array(z.string()).optional(),
  /** Bằng chứng bắt buộc (substring khớp trong evidence.text hoặc ref). */
  expectedEvidence: z.array(z.string()).optional(),
  /** Ràng buộc args cho tool cụ thể: `{ "actvn-mcp.student_search": [...] }`. */
  argumentConstraints: z
    .record(z.string(), z.array(argConstraintSchema))
    .optional(),
  maxSteps: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
  /** Case này agent PHẢI abstain (INSUFFICIENT_EVIDENCE). */
  mustAbstain: z.boolean().default(false),
  /** Số bước tối thiểu hợp lý (cho step-efficiency). */
  minSteps: z.number().int().positive().optional(),
  /** Câu trả lời KHÔNG được chứa các chuỗi này (adversarial / injection). */
  answerMustNotContain: z.array(z.string()).optional(),
});

export type AgentExpectation = z.infer<typeof agentExpectationSchema>;
export type ArgConstraint = z.infer<typeof argConstraintSchema>;
