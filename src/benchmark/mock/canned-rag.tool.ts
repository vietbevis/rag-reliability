import { z } from 'zod';
import type {
  AgentTool,
  ToolEvidence,
  ToolResult,
} from '../../tools/core/tool.types';
import { localToolDefinition } from '../../tools/impl/local-tool.helpers';
import type { CannedChunk } from '../agent-case.schema';

const inputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional(),
  strategy: z.enum(['vector', 'keyword', 'graph', 'hybrid']).optional(),
});
const outputSchema = z.object({
  strategy: z.string(),
  chunkCount: z.number().int(),
  chunks: z.array(z.record(z.string(), z.unknown())),
});

/**
 * `rag.search` TẤT ĐỊNH cho benchmark (PROMPT §29). Trả chunk từ bảng canned
 * theo substring khớp trong query; không khớp ⇒ rỗng (agent phải abstain).
 * Cùng interface / id `rag.search` như tool thật → agent không phân biệt.
 */
export class CannedRagSearchTool implements AgentTool {
  readonly definition = localToolDefinition({
    id: 'rag.search',
    displayName: 'RAG search (canned)',
    description:
      'Tra cứu tài liệu trong knowledge base nội bộ và trả về các đoạn văn liên quan.',
    inputSchema,
    outputSchema,
    timeoutMs: 5000,
    tags: ['rag', 'benchmark'],
  });

  constructor(private readonly canned: CannedChunk[]) {}

  execute(input: z.infer<typeof inputSchema>): Promise<ToolResult> {
    const q = input.query.toLowerCase();
    const matched = this.canned.filter((c) =>
      c.queryContains.length === 0
        ? false
        : c.queryContains.some((k) => q.includes(k.toLowerCase())),
    );
    const chunks = matched.flatMap((m) => m.chunks);

    const evidence: ToolEvidence[] = chunks.map((c) => ({
      kind: c.source === 'graph' ? 'graph' : 'chunk',
      ref: c.chunkId,
      text: c.content,
      documentId: c.documentId,
      chunkId: c.chunkId,
      score: c.score,
      section: c.section,
      heading: c.heading,
    }));

    return Promise.resolve({
      success: true,
      data: outputSchema.parse({
        strategy: input.strategy ?? 'hybrid',
        chunkCount: chunks.length,
        chunks: chunks.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          score: c.score,
          source: c.source,
          heading: c.heading,
          section: c.section,
          content: c.content,
        })),
      }),
      evidence,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      },
    });
  }
}
