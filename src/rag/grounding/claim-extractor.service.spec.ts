import { mockConfigService } from '../../config/config.mock';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
import { ClaimExtractorService } from './claim-extractor.service';

function build(
  overrides: {
    citation?: Partial<{ minAnswerTokens: number }>;
    llm?: LlmService;
  } = {},
) {
  const config = mockConfigService({
    rag: { temperature: 0 },
    citation: overrides.citation,
  });
  const factory = {
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService;
  const llm = overrides.llm ?? new LlmService(factory);
  return new ClaimExtractorService(llm, config);
}

/** Mock LlmService.chatStructured trả cố định. */
function llmReturning(data: Record<string, unknown>): LlmService {
  const chatStructured = jest.fn(() =>
    Promise.resolve({
      data,
      usage: {
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
        estimatedCost: 0,
      },
      model: 'm',
      provider: 'fake',
      latencyMs: 1,
    }),
  );
  return { chatStructured } as unknown as LlmService;
}

describe('ClaimExtractorService', () => {
  it('tách answer thành nhiều claim, id do backend cấp (c1, c2, ...)', async () => {
    const llm = llmReturning({
      claims: [
        { text: 'Trường cho phép bảo lưu tối đa 2 học kỳ.' },
        { text: 'Sinh viên phải gửi đơn trước 15 ngày.' },
      ],
    });
    const svc = build({ llm });
    const r = await svc.extract(
      'Trường cho phép bảo lưu tối đa 2 học kỳ và sinh viên phải gửi đơn ' +
        'trước 15 ngày khi muốn xin bảo lưu kết quả học tập.',
    );
    expect(r.method).toBe('llm');
    expect(r.claims).toEqual([
      { id: 'c1', text: 'Trường cho phép bảo lưu tối đa 2 học kỳ.' },
      { id: 'c2', text: 'Sinh viên phải gửi đơn trước 15 ngày.' },
    ]);
  });

  it('answer rỗng → claims rỗng, method skipped, không gọi LLM', async () => {
    const llm = llmReturning({ claims: [{ text: 'x' }] });
    const svc = build({ llm });
    const r = await svc.extract('   ');
    expect(r.claims).toEqual([]);
    expect(r.method).toBe('skipped');
    expect((llm.chatStructured as jest.Mock)).not.toHaveBeenCalled();
  });

  it('answer là abstention → claims rỗng (không có gì để trích dẫn)', async () => {
    const llm = llmReturning({ claims: [{ text: 'x' }] });
    const svc = build({ llm });
    const r = await svc.extract('Không tìm thấy thông tin trong tài liệu.');
    expect(r.claims).toEqual([]);
    expect(r.method).toBe('skipped');
  });

  it('answer ngắn (< minAnswerTokens) → 1 claim = chính nó, không gọi LLM', async () => {
    const llm = llmReturning({ claims: [{ text: 'x' }, { text: 'y' }] });
    const svc = build({ llm, citation: { minAnswerTokens: 6 } });
    const r = await svc.extract('Bảo lưu hai học kỳ.');
    expect(r.method).toBe('fallback-single');
    expect(r.claims).toEqual([{ id: 'c1', text: 'Bảo lưu hai học kỳ.' }]);
    expect(llm.chatStructured as jest.Mock).not.toHaveBeenCalled();
  });

  it('LLM trả 0 claim cho answer có nội dung → fallback 1 claim', async () => {
    const llm = llmReturning({ claims: [] });
    const svc = build({ llm });
    const answer =
      'Điểm trung bình tích lũy tối thiểu để không bị cảnh báo học vụ là 2.0 ' +
      'theo thang điểm 4 áp dụng từ khóa tuyển sinh 2020.';
    const r = await svc.extract(answer);
    expect(r.method).toBe('fallback-single');
    expect(r.claims).toEqual([{ id: 'c1', text: answer }]);
  });

  it('loại claim trùng lặp (chuẩn hóa hoa/thường + khoảng trắng)', async () => {
    const llm = llmReturning({
      claims: [
        { text: 'Học phí là 20 triệu đồng.' },
        { text: 'học phí   là 20 triệu đồng.' },
        { text: 'Không hoàn lại học phí.' },
      ],
    });
    const svc = build({ llm });
    const r = await svc.extract(
      'Học phí toàn khóa của chương trình đại trà là 20 triệu đồng mỗi năm ' +
        'và nhà trường không hoàn lại khoản này.',
    );
    expect(r.claims.map((c) => c.text)).toEqual([
      'Học phí là 20 triệu đồng.',
      'Không hoàn lại học phí.',
    ]);
  });

  it('provider fake: chạy được, tách answer theo câu', async () => {
    const svc = build();
    const r = await svc.extract(
      'Trường có ba cơ sở đào tạo. Cơ sở chính đặt tại Hà Nội. ' +
        'Sinh viên năm nhất học tại cơ sở Hòa Lạc.',
    );
    expect(r.claims.length).toBeGreaterThanOrEqual(2);
    expect(r.claims[0]!.id).toBe('c1');
  });
});
