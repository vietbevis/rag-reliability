import { Logger } from '@nestjs/common';
import type {
  AnswerVerificationService,
  VerificationResult,
} from '../../../rag/grounding/answer-verification.service';
import type { ToolEvidence } from '../../tools/tool.interface';
import type { AgentState } from '../agent-state';
import {
  computationToChunks,
  createFinalizeNode,
  evidenceToChunks,
} from './finalize.node';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

function state(over: Partial<AgentState>): AgentState {
  return {
    task: 'câu hỏi',
    startedAt: Date.now(),
    messages: [],
    steps: [],
    evidence: [],
    toolInvocations: {},
    toolCallCount: 0,
    toolFormatValid: 0,
    toolFormatTotal: 0,
    noProgressStreak: 0,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    answer: null,
    stopReason: null,
    finalStatus: null,
    citations: [],
    verifiedClaims: [],
    faithfulness: null,
    ...over,
  };
}

const kbEvidence: ToolEvidence = {
  kind: 'chunk',
  ref: 'k1',
  text: 'Sinh viên được bảo lưu hai học kỳ.',
  documentId: 'doc-1',
  chunkId: 'k1',
  score: 0.9,
  section: '2.1',
};

const computeEvidence: ToolEvidence = {
  kind: 'computation',
  ref: '37*18500',
  text: '37*18500 = 684500',
};

function stubVerification(
  result: Partial<VerificationResult>,
  spy?: { verifyAnswer?: jest.Mock; synthesizeAndVerify?: jest.Mock },
): AnswerVerificationService {
  const full: VerificationResult = {
    answer: 'câu trả lời',
    status: 'GROUNDED',
    claims: [],
    citations: [],
    faithfulness: { score: 1, grounded: true, claims: [] },
    usage: ZERO,
    ...result,
  };
  return {
    verifyAnswer: spy?.verifyAnswer ?? jest.fn().mockResolvedValue(full),
    synthesizeAndVerify:
      spy?.synthesizeAndVerify ?? jest.fn().mockResolvedValue(full),
  } as unknown as AnswerVerificationService;
}

const logger = new Logger('test');

describe('finalize.node', () => {
  it('agent đã có câu trả lời → verifyAnswer, gộp status vào FINAL step', async () => {
    const verifyAnswer = jest.fn().mockResolvedValue({
      answer: 'Bảo lưu hai học kỳ.',
      status: 'GROUNDED',
      claims: [
        {
          id: 'c1',
          text: 'x',
          supported: true,
          verdict: 'SUPPORTED',
          evidenceChunkIds: ['k1'],
        },
      ],
      citations: [
        {
          claimId: 'c1',
          claimText: 'x',
          kind: 'chunk',
          documentId: 'doc-1',
          chunkId: 'k1',
          valid: true,
        },
      ],
      faithfulness: { score: 0.9, grounded: true, claims: [] },
      usage: ZERO,
    });
    const node = createFinalizeNode({
      verification: stubVerification({}, { verifyAnswer }),
      logger,
    });

    const upd = await node(
      state({
        answer: 'Bảo lưu hai học kỳ.',
        stopReason: 'final',
        evidence: [kbEvidence],
      }),
    );

    expect(verifyAnswer).toHaveBeenCalledWith('Bảo lưu hai học kỳ.', [
      expect.objectContaining({ chunkId: 'k1', documentId: 'doc-1' }),
    ]);
    expect(upd.finalStatus).toBe('GROUNDED');
    expect(upd.answer).toBe('Bảo lưu hai học kỳ.');
    expect(upd.citations).toEqual([
      expect.objectContaining({ kind: 'chunk', documentId: 'doc-1' }),
    ]);
    expect(upd.steps).toEqual([
      expect.objectContaining({ type: 'FINAL', note: 'status=GROUNDED' }),
    ]);
  });

  it('dừng sớm không có câu trả lời → synthesizeAndVerify với evidence đã gom', async () => {
    const synthesizeAndVerify = jest.fn().mockResolvedValue({
      answer: 'Tổng là 684500 đồng.',
      status: 'GROUNDED',
      claims: [],
      citations: [
        {
          claimId: 'c1',
          claimText: 'Tổng là 684500',
          kind: 'chunk',
          documentId: 'computation',
          chunkId: 'compute:1',
          valid: true,
        },
      ],
      faithfulness: null,
      usage: ZERO,
    });
    const node = createFinalizeNode({
      verification: stubVerification({}, { synthesizeAndVerify }),
      logger,
    });

    const upd = await node(
      state({
        answer: null,
        stopReason: 'budget_steps',
        evidence: [computeEvidence],
      }),
    );

    expect(synthesizeAndVerify).toHaveBeenCalled();
    expect(upd.answer).toBe('Tổng là 684500 đồng.');
    // citation trỏ computation → kind 'computation', bỏ documentId/chunkId nội bộ
    expect(upd.citations).toEqual([
      expect.objectContaining({
        kind: 'computation',
        documentId: undefined,
        chunkId: undefined,
      }),
    ]);
  });

  it('citation của evidence graph → kind graph', async () => {
    const verifyAnswer = jest.fn().mockResolvedValue({
      answer: 'a',
      status: 'GROUNDED',
      claims: [],
      citations: [
        {
          claimId: 'c1',
          claimText: 'x',
          kind: 'chunk',
          documentId: 'doc-2',
          chunkId: 'g1',
          valid: true,
        },
      ],
      faithfulness: null,
      usage: ZERO,
    });
    const node = createFinalizeNode({
      verification: stubVerification({}, { verifyAnswer }),
      logger,
    });

    const upd = await node(
      state({
        answer: 'a',
        evidence: [
          {
            kind: 'graph',
            ref: 'g1',
            text: 'quan hệ',
            chunkId: 'g1',
            documentId: 'doc-2',
          },
        ],
      }),
    );
    expect(upd.citations).toEqual([expect.objectContaining({ kind: 'graph' })]);
  });
});

describe('evidence → chunk helpers', () => {
  it('evidenceToChunks bỏ computation, dedupe theo chunkId', () => {
    const chunks = evidenceToChunks([
      kbEvidence,
      { ...kbEvidence },
      computeEvidence,
      { kind: 'graph', ref: 'g1', text: 't', chunkId: 'g1' },
    ]);
    expect(chunks.map((c) => c.chunkId)).toEqual(['k1', 'g1']);
    expect(chunks[1]?.source).toBe('graph');
  });

  it('computationToChunks tạo chunk giả compute:N', () => {
    const chunks = computationToChunks([computeEvidence, kbEvidence]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkId: 'compute:1',
      documentId: 'computation',
      content: '37*18500 = 684500',
    });
  });
});
