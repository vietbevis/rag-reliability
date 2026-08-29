import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
import type { GroundingContext, RetrievedChunk } from '../../common/types';
import { ContextBuilderService } from '../context/context-builder.service';
import { AnswerGenerationService } from './answer-generation.service';

function build() {
  const config = mockConfigService({ rag: { temperature: 0 } });
  const factory = {
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService;
  const llm = new LlmService(factory);
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

describe('AnswerGenerationService (baseline)', () => {
  it('sinh answer + status hợp lệ + citedIndexes trong khoảng context', async () => {
    const svc = build();
    const r = await svc.generate(
      'Sinh viên được bảo lưu mấy học kỳ?',
      context([
        'Sinh viên được bảo lưu tối đa hai học kỳ liên tiếp.',
        'Đơn nộp trước mười lăm ngày.',
      ]),
    );
    expect(r.answer.length).toBeGreaterThan(0);
    expect([
      'GROUNDED',
      'PARTIALLY_GROUNDED',
      'INSUFFICIENT_EVIDENCE',
    ]).toContain(r.status);
    expect(r.citedIndexes.every((i) => i >= 1 && i <= 2)).toBe(true);
    expect(r.provider).toBe('fake');
    expect(r.usage.totalTokens).toBeGreaterThan(0);
  });

  it('tất định với cùng input', async () => {
    const svc = build();
    const ctx = context(['A B C.']);
    const a = await svc.generate('q', ctx);
    const b = await svc.generate('q', ctx);
    expect(a.answer).toBe(b.answer);
    expect(a.citedIndexes).toEqual(b.citedIndexes);
  });
});
