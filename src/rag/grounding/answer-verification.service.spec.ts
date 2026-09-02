import { mockConfigService } from '../../config/config.mock';
import type { Evidence, RetrievedChunk } from '../../common/types';
import type { ContextBuilderService } from '../context/context-builder.service';
import type { AnswerGenerationService } from './answer-generation.service';
import {
  ABSTAIN_ANSWER,
  AnswerVerificationService,
} from './answer-verification.service';
import type { CitationService } from './citation.service';
import type { ClaimExtractorService } from './claim-extractor.service';
import type { EvidenceMatcherService } from './evidence-matcher.service';
import type { FaithfulnessService } from './faithfulness.service';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

const chunk = (id: string): RetrievedChunk => ({
  chunkId: id,
  documentId: 'd1',
  content: 'nội dung ' + id,
  score: 0.8,
  source: 'vector',
  metadata: {},
});

interface Stubs {
  claims?: { id: string; text: string }[];
  extractionMethod?: 'llm' | 'fallback-single' | 'skipped';
  evidence?: Evidence[];
  faithGrounded?: boolean;
  faithClaims?: Evidence[];
  faithRootCause?: 'CONFLICTING_CONTEXT';
  genStatus?: 'GROUNDED' | 'INSUFFICIENT_EVIDENCE';
}

function makeAvs(s: Stubs = {}): AnswerVerificationService {
  const claims = s.claims ?? [{ id: 'c1', text: 'Trời có màu xanh.' }];
  const evidence: Evidence[] = s.evidence ?? [
    {
      claimId: 'c1',
      supported: true,
      verdict: 'SUPPORTED',
      evidenceChunkIds: ['k1'],
      score: 0.9,
    },
  ];

  const claimExtractor = {
    extract: () =>
      Promise.resolve({
        claims,
        method: s.extractionMethod ?? 'llm',
        provider: null,
        model: null,
        usage: ZERO,
        latencyMs: 1,
      }),
  } as unknown as ClaimExtractorService;

  const evidenceMatcher = {
    match: () => evidence,
  } as unknown as EvidenceMatcherService;

  const citation = {
    build: () =>
      Promise.resolve({
        citations: claims.map((c) => ({
          claimId: c.id,
          claimText: c.text,
          kind: 'chunk' as const,
          documentId: 'd1',
          chunkId: 'k1',
          valid: true,
        })),
        stats: {
          chunkCitations: claims.length,
          relationshipCitations: 0,
          invalidClaims: 0,
          relationshipLookups: 0,
        },
      }),
  } as unknown as CitationService;

  const faithfulness = {
    verify: () =>
      Promise.resolve({
        result: {
          score: s.faithGrounded === false ? 0.4 : 0.95,
          grounded: s.faithGrounded ?? true,
          claims:
            s.faithClaims ??
            claims.map((c) => ({
              claimId: c.id,
              supported: true,
              verdict: 'SUPPORTED' as const,
              evidenceChunkIds: ['k1'],
              score: 0.9,
            })),
          rootCause: s.faithRootCause,
        },
        usage: ZERO,
        latencyMs: 1,
        method: 'heuristic' as const,
      }),
  } as unknown as FaithfulnessService;

  const generation = {
    generate: () =>
      Promise.resolve({
        answer: 'Câu trả lời tổng hợp.',
        status: s.genStatus ?? 'GROUNDED',
        citedIndexes: [],
        claims: [],
        groundingRatio: 1,
        downgraded: false,
        regenerated: false,
        provider: 'fake',
        model: 'fake',
        usage: ZERO,
        latencyMs: 1,
      }),
  } as unknown as AnswerGenerationService;

  const contextBuilder = {
    build: (chunks: RetrievedChunk[]) => ({
      chunks,
      totalTokens: 10,
      sources: [],
    }),
  } as unknown as ContextBuilderService;

  return new AnswerVerificationService(
    generation,
    contextBuilder,
    claimExtractor,
    evidenceMatcher,
    citation,
    faithfulness,
    mockConfigService(),
  );
}

describe('AnswerVerificationService.verifyAnswer', () => {
  it('mọi claim SUPPORTED → GROUNDED, giữ câu trả lời', async () => {
    const res = await makeAvs().verifyAnswer('Trời xanh.', [chunk('k1')]);
    expect(res.status).toBe('GROUNDED');
    expect(res.answer).toBe('Trời xanh.');
    expect(res.claims[0]).toMatchObject({
      verdict: 'SUPPORTED',
      supported: true,
    });
    expect(res.citations).toHaveLength(1);
  });

  it('faithfulness không grounded → PARTIALLY_GROUNDED', async () => {
    const res = await makeAvs({ faithGrounded: false }).verifyAnswer('x', [
      chunk('k1'),
    ]);
    expect(res.status).toBe('PARTIALLY_GROUNDED');
    expect(res.answer).toBe('x');
  });

  it('có claim CONTRADICTED → CONFLICTING_EVIDENCE', async () => {
    const res = await makeAvs({
      faithClaims: [
        {
          claimId: 'c1',
          supported: false,
          verdict: 'CONTRADICTED',
          evidenceChunkIds: ['k1'],
          score: 0.2,
        },
      ],
    }).verifyAnswer('x', [chunk('k1')]);
    expect(res.status).toBe('CONFLICTING_EVIDENCE');
  });

  it('rootCause CONFLICTING_CONTEXT → CONFLICTING_EVIDENCE', async () => {
    const res = await makeAvs({
      faithRootCause: 'CONFLICTING_CONTEXT',
    }).verifyAnswer('x', [chunk('k1')]);
    expect(res.status).toBe('CONFLICTING_EVIDENCE');
  });

  it('mọi claim không được hỗ trợ → INSUFFICIENT_EVIDENCE + abstain', async () => {
    const res = await makeAvs({
      evidence: [
        {
          claimId: 'c1',
          supported: false,
          verdict: 'UNSUPPORTED',
          evidenceChunkIds: [],
          score: 0,
        },
      ],
      faithClaims: [
        {
          claimId: 'c1',
          supported: false,
          verdict: 'UNSUPPORTED',
          evidenceChunkIds: [],
          score: 0,
        },
      ],
      faithGrounded: false,
    }).verifyAnswer('câu bịa', [chunk('k1')]);
    expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.answer).toBe(ABSTAIN_ANSWER);
  });

  it('câu trả lời là lời từ chối (extraction skipped) → INSUFFICIENT_EVIDENCE', async () => {
    const res = await makeAvs({ extractionMethod: 'skipped' }).verifyAnswer(
      'Không tìm thấy thông tin.',
      [chunk('k1')],
    );
    expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('có claim nhưng KHÔNG có chunk nào → INSUFFICIENT_EVIDENCE + abstain', async () => {
    const res = await makeAvs().verifyAnswer('Câu trả lời không nguồn.', []);
    expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.answer).toBe(ABSTAIN_ANSWER);
    expect(res.claims[0]?.verdict).toBe('UNSUPPORTED');
  });
});

describe('AnswerVerificationService.synthesizeAndVerify', () => {
  it('không có chunk → abstain', async () => {
    const res = await makeAvs().synthesizeAndVerify('task', []);
    expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.answer).toBe(ABSTAIN_ANSWER);
  });

  it('generation trả INSUFFICIENT_EVIDENCE → abstain', async () => {
    const res = await makeAvs({
      genStatus: 'INSUFFICIENT_EVIDENCE',
    }).synthesizeAndVerify('task', [chunk('k1')]);
    expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('generation GROUNDED → verify câu tổng hợp', async () => {
    const res = await makeAvs().synthesizeAndVerify('task', [chunk('k1')]);
    expect(res.status).toBe('GROUNDED');
    expect(res.answer).toBe('Câu trả lời tổng hợp.');
  });
});
