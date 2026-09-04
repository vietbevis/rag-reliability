import { z } from 'zod';
import { agentExpectationSchema } from '../evaluation/agent/expectation';

/**
 * Một case benchmark agent (PROMPT §26-28). Môi trường tool **hoàn toàn mock**
 * (deterministic, nhanh, lặp lại — PROMPT §29). Benchmark tích hợp với RAG/MCP
 * server THẬT là suite riêng (PROMPT §29 "không trộn hai loại").
 */
export const BENCHMARK_CATEGORIES = [
  'basic',
  'rag',
  'tool-selection',
  'tool-args',
  'multi-step',
  'failure-recovery',
  'adversarial',
  'mcp-discovery',
  'mcp-selection',
  'mcp-args',
  'mcp-execution',
  'mcp-failure',
  'mcp-provider-failure',
  'cross-provider',
  'mcp-workflow',
] as const;

/** Một chunk canned cho `rag.search` mock — trả khi query chứa `queryContains`. */
export const cannedChunkSchema = z.object({
  queryContains: z.array(z.string()).default([]),
  chunks: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      content: z.string(),
      score: z.number().default(0.9),
      source: z.string().default('vector'),
      heading: z.string().optional(),
      section: z.string().optional(),
    }),
  ),
});

/** Một tool MCP mock. */
export const mockMcpToolSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object' }),
  readOnly: z.boolean().default(true),
  destructive: z.boolean().default(false),
  /** Bảng tra: match args (partial JSON) → kết quả text. */
  responses: z
    .array(
      z.object({
        whenArgs: z.record(z.string(), z.unknown()).default({}),
        text: z.string(),
        structured: z.unknown().optional(),
        isError: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Kết quả mặc định khi không response nào khớp. */
  fallbackText: z.string().default('(mock: không có dữ liệu khớp)'),
});

export const mockMcpProviderSchema = z.object({
  id: z.string(),
  defaultRiskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  tools: z.array(mockMcpToolSchema).default([]),
  /** Mô phỏng lỗi: connect fail (provider unavailable). */
  failConnect: z.string().optional(),
  /** Mô phỏng tool lỗi sau N lần gọi. */
  injectFailure: z
    .record(
      z.string(),
      z.object({
        message: z.string(),
        afterCalls: z.number().int().default(0),
      }),
    )
    .optional(),
});

export const agentBenchmarkCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(BENCHMARK_CATEGORIES),
  input: z.string().min(2),
  /** Bật local tool nào (mặc định: calculator + current_time + rag.search). */
  localTools: z
    .array(z.enum(['calculator.calculate', 'current_time.now', 'rag.search']))
    .optional(),
  /** Canned response cho `rag.search` mock. */
  cannedRag: z.array(cannedChunkSchema).default([]),
  /** Provider MCP mock (0..n). */
  mcpProviders: z.array(mockMcpProviderSchema).default([]),
  /** Giới hạn tool cho request (canonical id). */
  toolAllowlist: z.array(z.string()).optional(),
  /** Evaluator chạy (mặc định = theo category). */
  evaluators: z.array(z.string()).optional(),
  expectation: agentExpectationSchema.prefault({}),
});

export type AgentBenchmarkCase = z.infer<typeof agentBenchmarkCaseSchema>;
export type MockMcpProviderSpec = z.infer<typeof mockMcpProviderSchema>;
export type CannedChunk = z.infer<typeof cannedChunkSchema>;

/** Evaluator mặc định theo category. */
export function defaultEvaluators(category: string): string[] {
  const base = ['toolSelection', 'toolUsage', 'efficiency', 'safety'];
  switch (category) {
    case 'basic':
      return [...base, 'answerCorrectness', 'hallucination'];
    case 'rag':
    case 'multi-step':
    case 'cross-provider':
    case 'mcp-workflow':
      return [
        ...base,
        'answerCorrectness',
        'groundedness',
        'citation',
        'hallucination',
      ];
    case 'tool-args':
    case 'mcp-args':
      return [...base, 'toolArgument'];
    case 'failure-recovery':
    case 'mcp-failure':
    case 'mcp-provider-failure':
      return [...base, 'recovery', 'hallucination'];
    case 'adversarial':
      return [...base, 'hallucination', 'groundedness'];
    case 'mcp-discovery':
    case 'mcp-selection':
    case 'mcp-execution':
      return [...base, 'answerCorrectness', 'groundedness'];
    default:
      return base;
  }
}
