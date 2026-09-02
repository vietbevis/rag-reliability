import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { RetrievalService } from '../../rag/retrieval/retrieval.service';
import type {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  ToolEvidence,
} from './tool.interface';

const DEFAULT_TOP_K = 6;
/** Cắt content mỗi chunk trong `data` trả về model (evidence giữ toàn văn). */
const CHUNK_PREVIEW_CHARS = 1200;

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Câu hỏi / cụm từ cần tra trong knowledge base nội bộ.'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(`Số đoạn văn cần lấy (mặc định ${DEFAULT_TOP_K}).`),
  strategy: z
    .enum(['vector', 'keyword', 'graph', 'hybrid'])
    .optional()
    .describe(
      'vector = tương đồng ngữ nghĩa; keyword = khớp từ khoá chính xác; ' +
        'graph = đi theo quan hệ giữa các thực thể (dùng khi hỏi về liên hệ ' +
        'giữa các đối tượng); hybrid = kết hợp (mặc định).',
    ),
});

const chunkSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  score: z.number(),
  source: z.string(),
  heading: z.string().optional(),
  section: z.string().optional(),
  page: z.number().optional(),
  content: z.string(),
});

const outputSchema = z.object({
  strategy: z.string(),
  chunkCount: z.number().int(),
  chunks: z.array(chunkSchema),
});

type RagSearchInput = z.infer<typeof inputSchema>;
type RagSearchOutput = z.infer<typeof outputSchema>;

const EMPTY: RagSearchOutput = { strategy: '', chunkCount: 0, chunks: [] };

/**
 * Truy hồi tri thức nội bộ (PHASE 17 §7). Trả **chunk thô** (không generate) —
 * agent tự tổng hợp ở `finalize`. Bọc {@link RetrievalService}; lỗi hạ tầng
 * (embed query lỗi, Neo4j chết…) ⇒ `ok:false` để agent xoay hướng, KHÔNG che
 * thành "không có kết quả" (PROMPT §54).
 */
@Injectable()
export class RagSearchTool implements AgentTool<
  RagSearchInput,
  RagSearchOutput
> {
  readonly name = 'rag_search';
  readonly description =
    'Tra cứu tài liệu trong knowledge base nội bộ và trả về các đoạn văn liên ' +
    'quan (kèm nguồn). Dùng cho mọi câu hỏi cần dữ kiện từ tài liệu.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly timeoutMs = 30_000;
  readonly maxRetries = 0;

  constructor(private readonly retrieval: RetrievalService) {}

  async execute(
    input: RagSearchInput,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult<RagSearchOutput>> {
    const res = await this.retrieval.retrieve({
      query: input.query,
      topK: input.topK ?? DEFAULT_TOP_K,
      strategy: input.strategy,
      log: false,
    });

    if (res.error) {
      ctx.logger.warn(`rag_search: lỗi hạ tầng truy hồi — ${res.error}`);
      return {
        ok: false,
        data: EMPTY,
        evidence: [],
        error: `Truy hồi thất bại (lỗi hạ tầng, không phải thiếu tài liệu): ${res.error}`,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: res.usage.estimatedCost,
        },
      };
    }

    const chunks = res.chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      score: Number(c.score.toFixed(4)),
      source: c.source,
      heading: c.heading,
      section: c.section,
      page: c.page,
      content:
        c.content.length > CHUNK_PREVIEW_CHARS
          ? `${c.content.slice(0, CHUNK_PREVIEW_CHARS)}…`
          : c.content,
    }));

    const evidence: ToolEvidence[] = res.chunks.map((c) => ({
      kind: c.source === 'graph' ? 'graph' : 'chunk',
      ref: c.chunkId,
      text: c.content,
    }));

    return {
      ok: true,
      data: outputSchema.parse({
        strategy: res.strategy,
        chunkCount: chunks.length,
        chunks,
      }),
      evidence,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: res.usage.estimatedCost,
      },
      truncated: res.chunks.some((c) => c.content.length > CHUNK_PREVIEW_CHARS),
    };
  }
}
