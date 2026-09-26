import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { LlmService } from '../../ai/llm/llm.service';
import { LlmFactoryService } from '../../ai/llm/llm-factory.service';
import { FakeLlmProvider } from '../../ai/llm/providers/fake-llm.provider';
import { EntityExtractorService } from './entity-extractor.service';

function build(overrides: Partial<{ gleanings: number }> = {}) {
  const config = mockConfigService({
    graph: {
      extract: {
        maxTokens: 3000,
        gleanings: overrides.gleanings ?? 1,
        maxLlmCallsPerDoc: 40,
        concurrency: 1,
        entityTypes: ['PERSON', 'ORG', 'CONCEPT'],
        promptVersion: '1',
      },
    },
  });
  const factory = {
    create: () => new FakeLlmProvider(),
  } as unknown as LlmFactoryService;
  const llm = new LlmService(factory);
  return new EntityExtractorService(llm, new TokenCounterService(), config);
}

describe('EntityExtractorService (fake LLM)', () => {
  it('trích entity từ NER thô của fake provider, gọi 1 + gleanings lần', async () => {
    const svc = build({ gleanings: 1 });
    const r = await svc.extract(
      'Trường Đại Học Bách Khoa hợp tác với Phòng Đào Tạo về đào tạo sinh viên.',
    );
    expect(r.entities.length).toBeGreaterThan(0);
    // fake NER lấy cụm viết hoa → phải xuất hiện trong text (post-validate)
    for (const e of r.entities) {
      expect(
        'trường đại học bách khoa hợp tác với phòng đào tạo về đào tạo sinh viên.'.includes(
          e.name.toLowerCase(),
        ),
      ).toBe(true);
    }
    expect(r.llmCalls).toBe(2); // 1 initial + 1 gleaning
  });

  it('gleanings=0 → đúng 1 lời gọi', async () => {
    const svc = build({ gleanings: 0 });
    const r = await svc.extract('Bách Khoa và Phòng Đào Tạo.');
    expect(r.llmCalls).toBe(1);
  });

  it('loại entity type lạ → CONCEPT', async () => {
    const svc = build({ gleanings: 0 });
    const r = await svc.extract('Nguyễn Văn A học tại Bách Khoa.');
    for (const e of r.entities) {
      expect(['PERSON', 'ORG', 'CONCEPT']).toContain(e.type);
    }
  });

  it('quan hệ chỉ nối entity đã trích (không đầu mút lạ)', async () => {
    const svc = build({ gleanings: 0 });
    const r = await svc.extract(
      'Bách Khoa Hà Nội liên kết Phòng Đào Tạo và Khoa Máy Tính.',
    );
    const names = new Set(r.entities.map((e) => e.name.toLowerCase()));
    for (const rel of r.relationships) {
      expect(names.has(rel.source.toLowerCase())).toBe(true);
      expect(names.has(rel.target.toLowerCase())).toBe(true);
    }
  });

  it('text rỗng / không có danh từ riêng → không entity, không lỗi', async () => {
    const svc = build({ gleanings: 0 });
    const r = await svc.extract('các quy định về việc học tập của sinh viên.');
    expect(r.entities).toEqual([]);
    expect(r.relationships).toEqual([]);
  });

  it('output không hợp schema 2 lần liền → failed:true, không ném', async () => {
    const svc = build({ gleanings: 0 });
    const zodErr = Object.assign(new Error('too_big'), { name: 'ZodError' });
    const chatStructured = jest.fn().mockRejectedValue(zodErr);
    (svc as unknown as { llm: unknown }).llm = { chatStructured };
    const r = await svc.extract('Bách Khoa và Phòng Đào Tạo.');
    expect(r).toMatchObject({
      entities: [],
      relationships: [],
      failed: true,
      llmCalls: 2,
    });
    expect(chatStructured).toHaveBeenCalledTimes(2);
  });

  it('lỗi schema lần đầu, lần thử lại thành công → dùng kết quả, failed:false', async () => {
    const svc = build({ gleanings: 0 });
    const zodErr = Object.assign(new Error('too_big'), { name: 'ZodError' });
    const chatStructured = jest
      .fn()
      .mockRejectedValueOnce(zodErr)
      .mockResolvedValueOnce({
        data: {
          entities: [{ name: 'Bách Khoa', type: 'ORG', description: '' }],
          relationships: [],
        },
        usage: { inputTokens: 1, outputTokens: 1, estimatedCost: 0 },
      });
    (svc as unknown as { llm: unknown }).llm = { chatStructured };
    const r = await svc.extract('Bách Khoa và Phòng Đào Tạo.');
    expect(r.failed).toBe(false);
    expect(r.entities.map((e) => e.name)).toEqual(['Bách Khoa']);
    expect(r.llmCalls).toBe(2);
  });

  it('lỗi hạ tầng (timeout) vẫn ném để retry', async () => {
    const svc = build({ gleanings: 0 });
    const netErr = Object.assign(new Error('timed out'), { code: 'TIMEOUT' });
    (svc as unknown as { llm: unknown }).llm = {
      chatStructured: jest.fn().mockRejectedValue(netErr),
    };
    await expect(svc.extract('Bách Khoa.')).rejects.toThrow('timed out');
  });
});
