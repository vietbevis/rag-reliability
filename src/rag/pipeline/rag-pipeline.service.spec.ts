import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { LlmError } from '../../common/errors';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type { RetrievedChunk } from '../../common/types';
import { ContextBuilderService } from '../context/context-builder.service';
import { ContextValidatorService } from '../context/context-validator.service';
import { AnswerGenerationService } from '../grounding/answer-generation.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RerankerService } from '../../ai/reranking/reranker.service';
import { RagPipelineService } from './rag-pipeline.service';

function chunk(id: string, score: number): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'd0',
    content: `Nội dung ${id} đủ dài để làm context cho câu hỏi thử nghiệm.`,
    score,
    source: 'vector',
    section: 'Điều 1',
    metadata: {},
  };
}

function build(
  opts: {
    retrievedChunks?: RetrievedChunk[];
    genResult?: {
      answer: string;
      status: 'GROUNDED' | 'PARTIALLY_GROUNDED' | 'INSUFFICIENT_EVIDENCE';
      citedIndexes: number[];
    };
    genThrows?: unknown;
    minChunks?: number;
    retrievalError?: string;
    rerank?: boolean;
  } = {},
) {
  const ragQueryCreate = jest
    .fn()
    .mockResolvedValue({ id: 'rq-1', query: 'q' });
  const ragQueryUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    ragQuery: { create: ragQueryCreate, update: ragQueryUpdate },
  } as unknown as PrismaService;

  const retrieval = {
    retrieve: jest.fn().mockResolvedValue({
      query: 'q',
      strategy: 'vector',
      chunks: opts.retrievalError
        ? []
        : (opts.retrievedChunks ?? [chunk('a', 0.8), chunk('b', 0.6)]),
      latencyMs: 2,
      usage: { embeddingTokens: 4, estimatedCost: 0.001 },
      trace: {},
      error: opts.retrievalError,
    }),
  } as unknown as RetrievalService;

  const config = mockConfigService({
    rag: {
      maxContextTokens: 4000,
      minChunks: opts.minChunks ?? 1,
      minRelevance: 0,
    },
    rerank: { enabled: opts.rerank ?? false },
  });
  const contextBuilder = new ContextBuilderService(
    new TokenCounterService(),
    config,
  );
  const contextValidator = new ContextValidatorService(config);

  const rerankMock = jest.fn(
    (_q: string, chunks: RetrievedChunk[], k: number) =>
      Promise.resolve({
        chunks: chunks
          .slice(0, k)
          .map((c, i) => ({ ...c, rerankScore: 1 - i * 0.1, rank: i })),
        usage: { inputTokens: 3, outputTokens: 2, estimatedCost: 0 },
        latencyMs: 1,
        method: 'fake',
        fellBack: false,
      }),
  );
  const reranker = { rerank: rerankMock } as unknown as RerankerService;

  const generation = {
    generate: opts.genThrows
      ? jest.fn().mockRejectedValue(opts.genThrows)
      : jest.fn().mockResolvedValue({
          answer: opts.genResult?.answer ?? 'Câu trả lời.',
          status: opts.genResult?.status ?? 'GROUNDED',
          citedIndexes: opts.genResult?.citedIndexes ?? [1],
          provider: 'fake',
          model: 'fake-llm-v1',
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            estimatedCost: 0,
          },
          latencyMs: 1,
        }),
  } as unknown as AnswerGenerationService;

  return {
    svc: new RagPipelineService(
      prisma,
      retrieval,
      reranker,
      contextBuilder,
      contextValidator,
      generation,
      config,
    ),
    rerankMock,
    ragQueryUpdate,
    generate: generation.generate as jest.Mock,
  };
}

describe('RagPipelineService (PHASE 4 baseline)', () => {
  it('luồng đủ evidence: retrieve -> generate -> GROUNDED, persist RagQuery', async () => {
    const { svc, ragQueryUpdate } = build({
      genResult: {
        answer: 'Hai học kỳ.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
    });
    const r = await svc.query({ query: 'Bảo lưu mấy học kỳ?' });

    expect(r.status).toBe('GROUNDED');
    expect(r.answer).toBe('Hai học kỳ.');
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.chunkId).toBe('a');
    expect(r.citations[0]!.valid).toBe(true);
    expect(r.retrieval.chunkCount).toBe(2);
    expect(r.usage.inputTokens).toBe(20);
    expect(r.usage.embeddingTokens).toBe(4);
    expect(ragQueryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'GROUNDED',
          answer: 'Hai học kỳ.',
        }),
      }),
    );
  });

  it('không đủ evidence (0 chunk) -> INSUFFICIENT_EVIDENCE, KHÔNG gọi LLM', async () => {
    const { svc, generate } = build({ retrievedChunks: [] });
    const r = await svc.query({ query: 'câu hỏi lạ' });
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.answer).toMatch(/Không tìm thấy/);
    expect(generate).not.toHaveBeenCalled();
    expect(r.citations).toEqual([]);
  });

  it('LLM generation lỗi -> status ERROR, HTTP 200 (không 500), RagQuery.error được ghi', async () => {
    const { svc, ragQueryUpdate } = build({
      genThrows: new LlmError('RATE_LIMIT', 'quá tải'),
    });
    const r = await svc.query({ query: 'q' });
    expect(r.status).toBe('ERROR');
    expect(r.answer).toBeNull();
    expect(r.error).toContain('LLM_ERROR');
    expect(ragQueryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          error: expect.stringContaining('LLM_ERROR'),
        }),
      }),
    );
  });

  it('lỗi hạ tầng retrieval (embed query fail) -> KHÔNG che thành INSUFFICIENT_EVIDENCE', async () => {
    const { svc, generate } = build({ retrievalError: 'embed_query_failed' });
    const r = await svc.query({ query: 'q' });
    expect(r.status).toBe('ERROR');
    expect(r.error).toContain('embed_query_failed');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rethrow=true (biên API) -> ném lỗi hạ tầng thay vì trả status ERROR', async () => {
    const { svc, ragQueryUpdate } = build({
      retrievalError: 'embed_query_failed',
    });
    await expect(svc.query({ query: 'q' }, { rethrow: true })).rejects.toThrow(
      /embed_query_failed/,
    );
    // vẫn ghi RagQuery.error trước khi ném
    expect(ragQueryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          error: expect.stringContaining('embed_query_failed'),
        }),
      }),
    );
  });

  it('citedIndexes ngoài khoảng bị loại khỏi citations', async () => {
    const { svc } = build({
      genResult: {
        answer: 'x',
        status: 'GROUNDED',
        citedIndexes: [1, 5, 99],
      },
    });
    const r = await svc.query({ query: 'q' });
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.chunkId).toBe('a');
  });

  it('RERANK_ENABLED=false -> KHÔNG gọi reranker', async () => {
    const { svc, rerankMock } = build();
    await svc.query({ query: 'q' });
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it('rerank=true (override) -> gọi reranker, chunk vào context là chunk sau rerank', async () => {
    const { svc, rerankMock } = build({
      retrievedChunks: [chunk('a', 0.3), chunk('b', 0.9), chunk('c', 0.5)],
    });
    const r = await svc.query({ query: 'q', rerank: true });
    expect(rerankMock).toHaveBeenCalledWith('q', expect.any(Array), 5);
    // mock rerank trả chunk theo thứ tự input, rerankScore giảm dần → 'a' top
    expect(r.retrieval.chunks[0]!.chunkId).toBe('a');
    expect(r.retrieval.chunks[0]!.score).toBe(1); // = rerankScore
    expect((r.trace.rerank as { method: string }).method).toBe('fake');
  });

  it('RERANK_ENABLED=true qua config -> tự bật', async () => {
    const { svc, rerankMock } = build({ rerank: true });
    await svc.query({ query: 'q' });
    expect(rerankMock).toHaveBeenCalled();
  });

  it('rerank + req.topK > RERANK_CANDIDATES -> retrieval kéo ít nhất topK', async () => {
    const { svc } = build();
    const retrieve = (svc as unknown as { retrieval: RetrievalService })
      .retrieval.retrieve as jest.Mock;
    await svc.query({ query: 'q', rerank: true, topK: 40 });
    // config.mock rerank.candidates mặc định 20 → phải kéo max(20, 40) = 40
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 40 }),
    );
  });
});
