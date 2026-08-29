import { mockConfigService } from '../../config/config.mock';
import { PrismaService } from '../../database/prisma.service';
import { LlmError } from '../../common/errors';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type { RetrievedChunk } from '../../common/types';
import { ContextBuilderService } from '../context/context-builder.service';
import { ContextValidatorService } from '../context/context-validator.service';
import { AnswerGenerationService } from '../grounding/answer-generation.service';
import { ClaimExtractorService } from '../grounding/claim-extractor.service';
import { EvidenceMatcherService } from '../grounding/evidence-matcher.service';
import { CitationService } from '../grounding/citation.service';
import { FaithfulnessService } from '../grounding/faithfulness.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { TableExpansionService } from '../retrieval/table-expansion.service';
import { RerankerService } from '../../ai/reranking/reranker.service';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
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
      status:
        | 'GROUNDED'
        | 'PARTIALLY_GROUNDED'
        | 'INSUFFICIENT_EVIDENCE'
        | 'CONFLICTING_EVIDENCE';
      citedIndexes: number[];
      conflictNote?: string;
    };
    genThrows?: unknown;
    minChunks?: number;
    retrievalError?: string;
    rerank?: boolean;
    cite?: boolean;
    faithfulness?: boolean;
    claims?: Array<{ id: string; text: string }>;
    /** Claim do generation trả kèm (gộp call) — có thì pipeline bỏ ClaimExtractor. */
    genClaims?: Array<{ id: string; text: string }>;
  } = {},
) {
  const ragQueryCreate = jest
    .fn()
    .mockResolvedValue({ id: 'rq-1', query: 'q' });
  const ragQueryUpdate = jest.fn().mockResolvedValue({});
  const citationCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    ragQuery: { create: ragQueryCreate, update: ragQueryUpdate },
    citation: { createMany: citationCreateMany },
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
    citation: { enabled: opts.cite ?? false },
    faithfulness: {
      enabled: opts.faithfulness ?? false,
      verifierMode: 'heuristic',
      threshold: 0.8,
    },
  });
  const contextBuilder = new ContextBuilderService(
    new TokenCounterService(),
    config,
  );
  const contextValidator = new ContextValidatorService(config);

  // Mặc định pass-through; test riêng cho expansion nằm ở table-expansion.service.spec.
  const tableExpansion = {
    expand: jest.fn((chunks: RetrievedChunk[]) =>
      Promise.resolve({ chunks, trace: { enabled: false } }),
    ),
  } as unknown as TableExpansionService;

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
          conflictNote: opts.genResult?.conflictNote,
          claims: opts.genClaims ?? [],
          groundingRatio: 0.9,
          downgraded: false,
          regenerated: false,
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

  const extractMock = jest.fn().mockResolvedValue({
    claims: opts.claims ?? [
      { id: 'c1', text: opts.genResult?.answer ?? 'Câu trả lời.' },
    ],
    provider: 'fake',
    model: 'fake-llm-v1',
    usage: {
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
      estimatedCost: 0,
    },
    latencyMs: 1,
    method: 'llm',
  });
  const claimExtractor = {
    extract: extractMock,
  } as unknown as ClaimExtractorService;
  const evidenceMatcher = new EvidenceMatcherService(config);
  const citation = new CitationService(
    { enabled: false, isConnected: false } as unknown as ConstructorParameters<
      typeof CitationService
    >[0],
    config,
  );
  const fakeLlm = new LlmService({
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService);
  const faithfulnessVerifier = new FaithfulnessService(fakeLlm, config);

  return {
    svc: new RagPipelineService(
      prisma,
      retrieval,
      reranker,
      tableExpansion,
      contextBuilder,
      contextValidator,
      generation,
      claimExtractor,
      evidenceMatcher,
      citation,
      faithfulnessVerifier,
      config,
    ),
    rerankMock,
    ragQueryUpdate,
    citationCreateMany,
    extractMock,
    tableExpansionMock: tableExpansion.expand as jest.Mock,
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

  it('retrieval bảng: expand() chạy sau rerank/trước context, ghi trace.tableExpansion', async () => {
    const { svc, tableExpansionMock } = build({
      genResult: {
        answer: 'Hai học kỳ.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
    });
    tableExpansionMock.mockResolvedValueOnce({
      chunks: [chunk('a', 0.9), chunk('b', 0.8), chunk('a-t2', 0.7)],
      trace: { enabled: true, groups: 1, added: 1 },
    });
    const r = await svc.query({ query: 'liệt kê các mức học bổng' });
    expect(tableExpansionMock).toHaveBeenCalledTimes(1);
    expect(r.trace).toEqual(
      expect.objectContaining({
        tableExpansion: { enabled: true, groups: 1, added: 1 },
      }),
    );
    expect(r.retrieval.chunkCount).toBe(3);
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

  it('FINDING 6: req.strict được chuyển xuống contextValidator + generation', async () => {
    const { svc, generate } = build();
    const validate = jest.spyOn(
      (svc as unknown as { contextValidator: ContextValidatorService })
        .contextValidator,
      'validate',
    );
    await svc.query({ query: 'q', strict: true });
    expect(validate).toHaveBeenCalledWith(expect.anything(), true);
    expect(generate).toHaveBeenCalledWith('q', expect.anything(), {
      strict: true,
    });
  });

  it('FINDING 6: CONFLICTING_EVIDENCE → giữ nguyên answer + citations, conflictNote vào trace', async () => {
    const { svc } = build({
      genResult: {
        answer: 'Điều 1 nói A, Điều 5 nói không A — mâu thuẫn.',
        status: 'CONFLICTING_EVIDENCE',
        citedIndexes: [1, 2],
        conflictNote: 'Điều 1 vs Điều 5',
      },
      retrievedChunks: [chunk('a', 0.8), chunk('b', 0.6)],
    });
    const r = await svc.query({ query: 'q', strict: true });
    expect(r.status).toBe('CONFLICTING_EVIDENCE');
    expect(r.answer).toBe('Điều 1 nói A, Điều 5 nói không A — mâu thuẫn.');
    expect(r.citations).toHaveLength(2);
    expect((r.trace.generation as { conflictNote: string }).conflictNote).toBe(
      'Điều 1 vs Điều 5',
    );
  });

  it('FINDING 6: generation hạ về INSUFFICIENT_EVIDENCE → answer thành ABSTAIN, citations rỗng', async () => {
    const { svc, ragQueryUpdate } = build({
      genResult: {
        answer: 'Câu trả lời gốc của LLM trước khi bị hạ bậc.',
        status: 'INSUFFICIENT_EVIDENCE',
        citedIndexes: [1],
      },
    });
    const r = await svc.query({ query: 'q', strict: true });
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.answer).toMatch(/Không tìm thấy/);
    expect(r.citations).toEqual([]);
    expect(ragQueryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'INSUFFICIENT_EVIDENCE' }),
      }),
    );
  });
});

describe('RagPipelineService (PHASE 9 citation)', () => {
  const supportChunk = (id: string): RetrievedChunk => ({
    chunkId: id,
    documentId: 'doc-1',
    content:
      'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp ' +
      'và phải nộp đơn xin bảo lưu trước ít nhất mười lăm ngày.',
    score: 0.9,
    source: 'vector',
    section: 'Điều 5',
    metadata: {},
  });

  it('cite=true → tách claim, đối chiếu evidence, trả claims + citations backend', async () => {
    const { svc, extractMock, citationCreateMany } = build({
      cite: true,
      retrievedChunks: [supportChunk('k1')],
      genResult: {
        answer:
          'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp và phải nộp ' +
          'đơn xin bảo lưu trước ít nhất mười lăm ngày.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      claims: [
        {
          id: 'c1',
          text: 'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp.',
        },
        {
          id: 'c2',
          text: 'Phải nộp đơn xin bảo lưu trước ít nhất mười lăm ngày.',
        },
      ],
    });
    const r = await svc.query({ query: 'q' });

    expect(extractMock).toHaveBeenCalled();
    expect(r.claims).toHaveLength(2);
    expect(r.claims[0]).toMatchObject({ id: 'c1', supported: true });
    expect(r.citations.length).toBeGreaterThanOrEqual(1);
    expect(r.citations.every((c) => c.claimId.startsWith('c'))).toBe(true);
    expect(r.citations[0]!.kind).toBe('chunk');
    expect(citationCreateMany).toHaveBeenCalled();
    expect(
      (r.trace.citation as { supportedClaims: number }).supportedClaims,
    ).toBe(2);
  });

  it('gộp call: generation trả kèm claims → KHÔNG gọi ClaimExtractor riêng', async () => {
    const { svc, extractMock } = build({
      cite: true,
      retrievedChunks: [supportChunk('k1')],
      genResult: {
        answer:
          'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp và phải nộp đơn ' +
          'trước ít nhất mười lăm ngày.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      genClaims: [
        {
          id: 'c1',
          text: 'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp.',
        },
        { id: 'c2', text: 'Phải nộp đơn trước ít nhất mười lăm ngày.' },
      ],
    });
    const r = await svc.query({ query: 'q' });

    expect(extractMock).not.toHaveBeenCalled();
    expect(r.claims).toHaveLength(2);
    expect(
      (r.trace.citation as { extractionMethod: string }).extractionMethod,
    ).toBe('consolidated');
  });

  it('cite=false (mặc định spec) → baseline: claims rỗng, citation map thô', async () => {
    const { svc, extractMock } = build({
      genResult: {
        answer: 'Câu trả lời.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
    });
    const r = await svc.query({ query: 'q' });
    expect(extractMock).not.toHaveBeenCalled();
    expect(r.claims).toEqual([]);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.claimId).toBe('');
  });

  it('cite=true nhưng INSUFFICIENT_EVIDENCE → không tách claim, claims + citations rỗng', async () => {
    const { svc, extractMock } = build({
      cite: true,
      genResult: {
        answer: 'x',
        status: 'INSUFFICIENT_EVIDENCE',
        citedIndexes: [],
      },
    });
    const r = await svc.query({ query: 'q' });
    expect(extractMock).not.toHaveBeenCalled();
    expect(r.claims).toEqual([]);
    expect(r.citations).toEqual([]);
  });

  it('cite=true: claim không có chunk hỗ trợ → citation valid=false', async () => {
    const { svc } = build({
      cite: true,
      retrievedChunks: [supportChunk('k1')],
      genResult: {
        answer: 'Một khẳng định.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      claims: [
        { id: 'c1', text: 'Trường có phân hiệu tại Singapore từ năm 2030.' },
      ],
    });
    const r = await svc.query({ query: 'q' });
    expect(r.claims[0]!.supported).toBe(false);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.valid).toBe(false);
  });

  it('cite=true: usage cộng thêm token của bước tách claim', async () => {
    const { svc } = build({
      cite: true,
      retrievedChunks: [supportChunk('k1')],
      genResult: {
        answer: 'Sinh viên bảo lưu hai học kỳ.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      claims: [{ id: 'c1', text: 'Sinh viên bảo lưu hai học kỳ liên tiếp.' }],
    });
    const r = await svc.query({ query: 'q' });
    // generation inputTokens 20 + extract inputTokens 5
    expect(r.usage.inputTokens).toBe(25);
  });
});

describe('RagPipelineService (PHASE 10 faithfulness)', () => {
  const supportChunk = (id: string, content?: string): RetrievedChunk => ({
    chunkId: id,
    documentId: 'doc-1',
    content:
      content ??
      'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp.',
    score: 0.9,
    source: 'vector',
    section: 'Điều 5',
    metadata: {},
  });

  it('faithfulness=true: chạy verifier, trả faithfulness result và cập nhật DB', async () => {
    const { svc, ragQueryUpdate } = build({
      cite: true,
      faithfulness: true,
      retrievedChunks: [supportChunk('k1')],
      genResult: {
        answer: 'Sinh viên được bảo lưu hai học kỳ liên tiếp.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      claims: [
        { id: 'c1', text: 'Sinh viên được bảo lưu hai học kỳ liên tiếp.' },
      ],
    });

    const r = await svc.query({ query: 'q' });

    expect(r.faithfulness).toBeDefined();
    expect(r.faithfulness?.grounded).toBe(true);
    expect(r.faithfulness?.score).toBe(1.0);
    expect(r.claims[0]?.verdict).toBe('SUPPORTED');
    expect(ragQueryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          faithfulness: 1.0,
        }),
      }),
    );
  });

  it('phát hiện mâu thuẫn số liệu -> status chuyển thành CONFLICTING_EVIDENCE', async () => {
    const { svc } = build({
      cite: true,
      faithfulness: true,
      retrievedChunks: [
        supportChunk('k1', 'Sinh viên được phép bảo lưu tối đa 2 học kỳ.'),
      ],
      genResult: {
        answer: 'Sinh viên được bảo lưu 3 học kỳ.',
        status: 'GROUNDED',
        citedIndexes: [1],
      },
      claims: [{ id: 'c1', text: 'Sinh viên được bảo lưu 3 học kỳ.' }],
    });

    const r = await svc.query({ query: 'q' });

    expect(r.status).toBe('CONFLICTING_EVIDENCE');
    expect(r.faithfulness?.grounded).toBe(false);
    expect(r.claims[0]?.verdict).toBe('CONTRADICTED');
  });

  it('INSUFFICIENT_EVIDENCE -> faithfulness score 1.0, grounded = true', async () => {
    const { svc } = build({
      faithfulness: true,
      genResult: {
        answer: 'x',
        status: 'INSUFFICIENT_EVIDENCE',
        citedIndexes: [],
      },
    });

    const r = await svc.query({ query: 'q' });

    expect(r.faithfulness?.score).toBe(1.0);
    expect(r.faithfulness?.grounded).toBe(true);
    expect(r.faithfulness?.claims).toEqual([]);
  });
});
