import { mockConfigService } from '../../config/config.mock';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
import type {
  Claim,
  Evidence,
  RetrievedChunk,
} from '../../common/types/pipeline.contracts';
import { FaithfulnessService } from './faithfulness.service';

function build(
  overrides: {
    faithfulness?: Partial<{
      verifierMode: 'auto' | 'heuristic' | 'llm';
      threshold: number;
    }>;
    llm?: LlmService;
  } = {},
) {
  const config = mockConfigService({
    faithfulness: overrides.faithfulness,
  });
  const factory = {
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService;
  const llm = overrides.llm ?? new LlmService(factory);
  return new FaithfulnessService(llm, config);
}

function chunk(id: string, content: string, score = 0.9): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'doc-1',
    content,
    score,
    source: 'vector',
    metadata: {},
  };
}

describe('FaithfulnessService', () => {
  it('câu trả lời là abstention -> score 1.0, grounded = true, method skipped', async () => {
    const svc = build();
    const res = await svc.verify(
      'Không tìm thấy thông tin đủ tin cậy trong knowledge base.',
      [],
      [],
      [chunk('c1', 'nội dung')],
      'INSUFFICIENT_EVIDENCE',
    );

    expect(res.result.score).toBe(1.0);
    expect(res.result.grounded).toBe(true);
    expect(res.method).toBe('skipped');
    expect(res.result.claims).toEqual([]);
  });

  it('toàn bộ claim supported -> score 1.0, grounded = true', async () => {
    const svc = build({ faithfulness: { verifierMode: 'heuristic' } });
    const claims: Claim[] = [
      { id: 'c1', text: 'Sinh viên được bảo lưu hai học kỳ' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.9,
      },
    ];
    const chunks = [
      chunk('k1', 'Sinh viên được phép bảo lưu tối đa hai học kỳ liên tiếp.'),
    ];

    const res = await svc.verify(
      'Sinh viên được bảo lưu hai học kỳ',
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );

    expect(res.result.score).toBe(1.0);
    expect(res.result.grounded).toBe(true);
    expect(res.result.rootCause).toBeUndefined();
    expect(res.result.claims[0]?.verdict).toBe('SUPPORTED');
  });

  it('phát hiện mâu thuẫn số liệu (heuristic) -> verdict CONTRADICTED, grounded = false, GENERATION_HALLUCINATION', async () => {
    const svc = build({ faithfulness: { verifierMode: 'heuristic' } });
    const claims: Claim[] = [
      { id: 'c1', text: 'Sinh viên được bảo lưu 3 học kỳ' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.8,
      },
    ];
    const chunks = [
      chunk('k1', 'Sinh viên được phép bảo lưu tối đa 2 học kỳ liên tiếp.'),
    ];

    const res = await svc.verify(
      'Sinh viên được bảo lưu 3 học kỳ',
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );

    expect(res.result.grounded).toBe(false);
    expect(res.result.claims[0]?.verdict).toBe('CONTRADICTED');
    expect(res.result.rootCause).toBe('GENERATION_HALLUCINATION');
  });

  // Hồi quy [P0] docs/audit/FAITHFULNESS_REVIEW.md: câu trả lời khẳng định hợp
  // lệ KHÔNG được bị đánh mâu thuẫn chỉ vì một chunk KHÁC (không phải evidence
  // của claim) chứa điều khoản cấm.
  it('claim khẳng định + chunk cấm KHÔNG phải evidence -> KHÔNG mâu thuẫn', async () => {
    const svc = build({ faithfulness: { verifierMode: 'heuristic' } });
    const claims: Claim[] = [
      {
        id: 'c1',
        text: 'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp',
      },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.9,
      },
    ];
    const chunks = [
      chunk(
        'k1',
        'Điều 1. Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học.',
      ),
      chunk(
        'k2',
        'Điều 3. Trong thời gian bảo lưu, sinh viên không được đăng ký học phần, không được dự thi kết thúc học phần.',
      ),
    ];

    const res = await svc.verify(
      claims[0]!.text,
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );

    expect(res.result.claims[0]?.verdict).toBe('SUPPORTED');
    expect(res.result.grounded).toBe(true);
    expect(res.result.score).toBe(1.0);
  });

  // Hồi quy: heuristic mâu thuẫn số liệu giữa 2 chunk KHÁC CHỦ ĐỀ (GPA vs tín
  // chỉ, cùng chứa số) KHÔNG được đánh sập câu trả lời hợp lệ ở chế độ auto.
  it('auto: hai chunk khác chủ đề cùng chứa số -> KHÔNG CONFLICTING_EVIDENCE', async () => {
    const svc = build({
      faithfulness: { verifierMode: 'auto', threshold: 0.5 },
    });
    const claims: Claim[] = [
      { id: 'c1', text: 'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.9,
      },
    ];
    const chunks = [
      chunk(
        'k1',
        'Sinh viên được bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học.',
      ),
      chunk(
        'k2',
        'Điểm trung bình tích luỹ tối thiểu để xét tốt nghiệp là hai phẩy không; học lại quá năm phần trăm số tín chỉ thì hạ một mức xếp loại.',
      ),
    ];

    const res = await svc.verify(
      claims[0]!.text,
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );
    expect(res.result.rootCause).not.toBe('CONFLICTING_CONTEXT');
    expect(res.result.claims[0]?.verdict).not.toBe('CONTRADICTED');
  });

  it('ngữ cảnh có mâu thuẫn chéo giữa các chunk -> CONFLICTING_CONTEXT', async () => {
    const svc = build({ faithfulness: { verifierMode: 'heuristic' } });
    const claims: Claim[] = [
      { id: 'c1', text: 'Sinh viên được bảo lưu 2 học kỳ' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.9,
      },
    ];
    const chunks = [
      chunk('k1', 'Quy định đào tạo: sinh viên được bảo lưu tối đa 2 học kỳ.'),
      chunk('k2', 'Quy định sửa đổi: sinh viên được bảo lưu tối đa 1 học kỳ.'),
    ];

    const res = await svc.verify(
      'Sinh viên được bảo lưu 2 học kỳ',
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );

    expect(res.result.grounded).toBe(false);
    expect(res.result.rootCause).toBe('CONFLICTING_CONTEXT');
  });

  it('0 chunk ngữ cảnh -> RETRIEVAL_FAILURE', async () => {
    const svc = build({ faithfulness: { verifierMode: 'heuristic' } });
    const claims: Claim[] = [{ id: 'c1', text: 'Một khẳng định' }];
    const evidence: Evidence[] = [];

    const res = await svc.verify(
      'Một khẳng định',
      claims,
      evidence,
      [],
      'GROUNDED',
    );

    expect(res.result.grounded).toBe(false);
    expect(res.result.rootCause).toBe('RETRIEVAL_FAILURE');
  });

  it('gọi LLM NLI khi ở chế độ llm và cập nhật verdict từ LLM', async () => {
    const mockLlm = {
      chatStructured: jest.fn().mockResolvedValue({
        data: {
          verdicts: [
            { claimId: 'c1', verdict: 'SUPPORTED', reason: 'khớp' },
            { claimId: 'c2', verdict: 'UNSUPPORTED', reason: 'không thấy' },
          ],
        },
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          estimatedCost: 0.001,
        },
      }),
    } as unknown as LlmService;

    const svc = build({
      faithfulness: { verifierMode: 'llm', threshold: 0.5 },
      llm: mockLlm,
    });

    const claims: Claim[] = [
      { id: 'c1', text: 'Ý một' },
      { id: 'c2', text: 'Ý hai' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0,
      },
      {
        claimId: 'c2',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0,
      },
    ];
    const chunks = [chunk('k1', 'Ngữ cảnh ý một')];

    const res = await svc.verify(
      'Ý một và ý hai',
      claims,
      evidence,
      chunks,
      'GROUNDED',
    );

    expect(mockLlm.chatStructured).toHaveBeenCalled();
    expect(res.method).toBe('llm');
    expect(res.result.claims[0]?.verdict).toBe('SUPPORTED');
    expect(res.result.claims[1]?.verdict).toBe('UNSUPPORTED');
    expect(res.result.score).toBe(0.5);
    expect(res.result.grounded).toBe(true); // 0.5 >= threshold 0.5
  });
});
