import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
import type { GroundingContext, RetrievedChunk } from '../../common/types';
import { ContextBuilderService } from '../context/context-builder.service';
import { AnswerGenerationService } from './answer-generation.service';

function build(
  overrides: {
    grounding?: Partial<{
      strict: boolean;
      minGroundingRatio: number;
      regenerateOnUngrounded: boolean;
    }>;
    llm?: Partial<LlmService>;
  } = {},
) {
  const config = mockConfigService({
    rag: { temperature: 0 },
    grounding: overrides.grounding,
  });
  const factory = {
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService;
  const llm = (overrides.llm ??
    new LlmService(factory)) as unknown as LlmService;
  const contextBuilder = new ContextBuilderService(
    new TokenCounterService(),
    config,
  );
  return new AnswerGenerationService(llm, contextBuilder, config);
}

function context(contents: string[]): GroundingContext {
  const chunks: RetrievedChunk[] = contents.map((content, i) => ({
    chunkId: `c${i}`,
    documentId: 'd0',
    content,
    score: 1 - i * 0.1,
    source: 'vector',
    section: `Điều ${i + 1}`,
    metadata: {},
  }));
  return { chunks, totalTokens: 10, sources: [] };
}

/** Mock LlmService trả structured cố định (1 hoặc nhiều lần liên tiếp). */
function llmReturning(...datas: Array<Record<string, unknown>>): {
  llm: LlmService;
  calls: () => number;
} {
  let n = 0;
  const chatStructured = jest.fn(() => {
    const data = datas[Math.min(n, datas.length - 1)];
    n++;
    return Promise.resolve({
      data,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCost: 0,
      },
      model: 'm',
      provider: 'fake',
      latencyMs: 1,
    });
  });
  return {
    llm: { chatStructured } as unknown as LlmService,
    calls: () => n,
  };
}

describe('AnswerGenerationService', () => {
  it('baseline (non-strict): sinh answer + status + citedIndexes hợp lệ, tất định', async () => {
    const svc = build();
    const ctx = context([
      'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp.',
      'Đơn nộp trước mười lăm ngày.',
    ]);
    const a = await svc.generate('Sinh viên bảo lưu mấy học kỳ?', ctx);
    const b = await svc.generate('Sinh viên bảo lưu mấy học kỳ?', ctx);
    expect(a.answer.length).toBeGreaterThan(0);
    expect(a.citedIndexes.every((i) => i >= 1 && i <= 2)).toBe(true);
    expect(a.provider).toBe('fake');
    expect(a.answer).toBe(b.answer);
    expect(a.downgraded).toBe(false);
    expect(a.regenerated).toBe(false);
  });

  it('answer là abstention trá hình nhưng status GROUNDED → hạ về INSUFFICIENT_EVIDENCE (cả non-strict)', async () => {
    const { llm } = llmReturning({
      answer: 'Không tìm thấy thông tin trong tài liệu.',
      status: 'GROUNDED',
      usedContext: [1],
      groundedInContext: true,
      conflictNote: '',
    });
    const svc = build({ llm });
    const r = await svc.generate('q', context(['nội dung ngữ cảnh']));
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.downgraded).toBe(true);
  });

  it('GROUNDED nhưng usedContext rỗng → INSUFFICIENT_EVIDENCE', async () => {
    const { llm } = llmReturning({
      answer: 'Câu trả lời không trích dẫn gì.',
      status: 'GROUNDED',
      usedContext: [],
      groundedInContext: true,
      conflictNote: '',
    });
    const svc = build({ llm });
    const r = await svc.generate('q', context(['abc']));
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('strict + LLM tự báo groundedInContext=false → hạ GROUNDED xuống PARTIALLY_GROUNDED', async () => {
    const { llm } = llmReturning({
      answer: 'Nội dung ngữ cảnh có nói điều này.',
      status: 'GROUNDED',
      usedContext: [1],
      groundedInContext: false,
      conflictNote: '',
    });
    const svc = build({ llm, grounding: { strict: true } });
    const r = await svc.generate(
      'q',
      context(['Nội dung ngữ cảnh có nói điều này rõ ràng.']),
    );
    expect(r.status).toBe('PARTIALLY_GROUNDED');
    expect(r.downgraded).toBe(true);
  });

  it('strict + grounding lexical thấp → sinh lại 1 lần', async () => {
    const { llm, calls } = llmReturning(
      {
        answer: 'Hoàn toàn từ ngữ xa lạ không dính dáng ngữ cảnh gì cả.',
        status: 'GROUNDED',
        usedContext: [1],
        groundedInContext: true,
        conflictNote: '',
      },
      {
        answer: 'Sinh viên được bảo lưu hai học kỳ theo ngữ cảnh.',
        status: 'GROUNDED',
        usedContext: [1],
        groundedInContext: true,
        conflictNote: '',
      },
    );
    const svc = build({
      llm,
      grounding: {
        strict: true,
        minGroundingRatio: 0.4,
        regenerateOnUngrounded: true,
      },
    });
    const r = await svc.generate(
      'q',
      context(['Sinh viên được bảo lưu hai học kỳ liên tiếp.']),
    );
    expect(calls()).toBe(2);
    expect(r.regenerated).toBe(true);
  });

  it('strict + lần sinh lại VẪN grounding thấp → chỉ sinh lại 1 lần, lấy kết quả lần 2', async () => {
    const { llm, calls } = llmReturning(
      {
        answer: 'Từ ngữ xa lạ hoàn toàn không dính dáng.',
        status: 'GROUNDED',
        usedContext: [1],
        groundedInContext: true,
        conflictNote: '',
      },
      {
        answer: 'Vẫn là từ ngữ xa lạ khác biệt hoàn toàn nữa.',
        status: 'GROUNDED',
        usedContext: [1],
        groundedInContext: true,
        conflictNote: '',
      },
    );
    const svc = build({
      llm,
      grounding: {
        strict: true,
        minGroundingRatio: 0.4,
        regenerateOnUngrounded: true,
      },
    });
    const r = await svc.generate(
      'q',
      context(['Nội dung ngữ cảnh riêng biệt.']),
    );
    expect(calls()).toBe(2); // KHÔNG lặp vô hạn — tối đa 1 lần sinh lại
    expect(r.regenerated).toBe(true);
    expect(r.answer).toBe('Vẫn là từ ngữ xa lạ khác biệt hoàn toàn nữa.');
    expect(r.status).toBe('PARTIALLY_GROUNDED'); // vẫn bị hạ bậc
    expect(r.usage.inputTokens).toBe(20); // cộng dồn cả 2 lần
  });

  it('strict + regenerateOnUngrounded=false → KHÔNG sinh lại', async () => {
    const { llm, calls } = llmReturning({
      answer: 'Từ ngữ xa lạ hoàn toàn.',
      status: 'GROUNDED',
      usedContext: [1],
      groundedInContext: true,
      conflictNote: '',
    });
    const svc = build({
      llm,
      grounding: {
        strict: true,
        minGroundingRatio: 0.4,
        regenerateOnUngrounded: false,
      },
    });
    await svc.generate('q', context(['Nội dung khác biệt.']));
    expect(calls()).toBe(1);
  });

  it('CONFLICTING_EVIDENCE giữ nguyên + conflictNote', async () => {
    const { llm } = llmReturning({
      answer: 'Điều 1 nói A, Điều 5 nói không A — hai nguồn mâu thuẫn.',
      status: 'CONFLICTING_EVIDENCE',
      usedContext: [1, 2],
      groundedInContext: true,
      conflictNote: 'Điều 1 vs Điều 5',
    });
    const svc = build({ llm, grounding: { strict: true } });
    const r = await svc.generate(
      'q',
      context(['Điều 1: A', 'Điều 5: không A']),
    );
    expect(r.status).toBe('CONFLICTING_EVIDENCE');
    expect(r.conflictNote).toBe('Điều 1 vs Điều 5');
  });
});
