import { z } from 'zod';
import { LlmProvider } from '../llm-provider.enum';
import { properNouns } from '../../../common/utils/text.util';
import { FakeLlmProvider } from './fake-llm.provider';

const svc = new FakeLlmProvider();

describe('FakeLlmProvider', () => {
  it('provider = FAKE, luôn configured, chi phí 0', async () => {
    expect(svc.provider).toBe(LlmProvider.FAKE);
    expect(svc.isConfigured()).toBe(true);
    const r = await svc.chat([{ role: 'user', content: 'Xin chào.' }]);
    expect(r.usage.estimatedCost).toBe(0);
    expect(r.provider).toBe(LlmProvider.FAKE);
  });

  it('chat: trích câu đầu tiên của user message + nhãn [fake], tất định', async () => {
    const msg = [
      { role: 'user' as const, content: 'Câu một. Câu hai. Câu ba.' },
    ];
    const a = await svc.chat(msg);
    const b = await svc.chat(msg);
    expect(a.content).toBe('[fake] Câu một.');
    expect(b.content).toBe(a.content);
    expect(a.usage.totalTokens).toBeGreaterThan(0);
  });

  it('chatStream: ghép lại = chat', async () => {
    const msg = [{ role: 'user' as const, content: 'Một hai ba bốn năm.' }];
    let streamed = '';
    for await (const c of svc.chatStream(msg)) streamed += c.delta;
    const full = (await svc.chat(msg)).content;
    expect(streamed.trim()).toBe(full.trim());
  });

  it('chatStructured: dựng object hợp lệ theo schema; answer/status có heuristic', async () => {
    const schema = z.object({
      answer: z.string(),
      status: z.enum([
        'GROUNDED',
        'PARTIALLY_GROUNDED',
        'INSUFFICIENT_EVIDENCE',
      ]),
      claims: z.array(z.object({ text: z.string() })),
      citationIds: z.array(z.string()),
    });
    const r = await svc.chatStructured(
      [{ role: 'user', content: 'Sinh viên được bảo lưu hai học kỳ.' }],
      schema,
    );
    expect(() => schema.parse(r.data)).not.toThrow();
    expect(r.data.answer).toContain('[fake]');
    expect(r.data.status).toBe('GROUNDED');
    expect(r.data.claims.length).toBeGreaterThanOrEqual(1);
  });

  it('chatStructured: số có ràng buộc min không sinh giá trị vi phạm schema', async () => {
    const schema = z.object({
      score: z.number().min(0).max(1),
      rank: z.number().int().min(1),
      count: z.number().int().positive(),
    });
    const r = await svc.chatStructured(
      [{ role: 'user', content: 'x' }],
      schema,
    );
    expect(() => schema.parse(r.data)).not.toThrow();
    expect(r.data.score).toBeGreaterThan(0.5); // field điểm số -> lạc quan
    expect(r.data.rank).toBeGreaterThanOrEqual(1);
    expect(r.data.count).toBeGreaterThanOrEqual(1);
  });

  it('chatStructured: schema extraction -> NER thô entity + relationship', async () => {
    const schema = z.object({
      entities: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
        }),
      ),
      relationships: z.array(
        z.object({
          source: z.string(),
          target: z.string(),
          type: z.string(),
          description: z.string(),
          strength: z.number(),
        }),
      ),
    });
    const r = await svc.chatStructured(
      [
        {
          role: 'user',
          content:
            'Nguyễn Văn A làm việc tại Công Ty ABC đặt trụ sở ở Thành Phố Hà Nội.',
        },
      ],
      schema,
    );
    expect(() => schema.parse(r.data)).not.toThrow();
    expect(r.data.entities.length).toBeGreaterThan(0);
    expect(r.data.entities.map((e) => e.name)).toContain('Nguyễn Văn A');
    expect(r.data.relationships[0]?.strength).toBe(5);
  });

  it('chatStructured tất định', async () => {
    const schema = z.object({ x: z.string(), y: z.number(), z: z.boolean() });
    const a = await svc.chatStructured(
      [{ role: 'user', content: 'abc' }],
      schema,
    );
    const b = await svc.chatStructured(
      [{ role: 'user', content: 'abc' }],
      schema,
    );
    expect(a.data).toEqual(b.data);
  });
});

describe('FakeLlmProvider.chatWithTools (scriptable)', () => {
  const searchTool = {
    name: 'rag_search',
    description: 'Tìm trong knowledge base',
    parameters: z.object({
      query: z.string(),
      topK: z.number().int().optional(),
    }),
  };

  it('supportsNativeToolCalling = true', () => {
    expect(new FakeLlmProvider().supportsNativeToolCalling()).toBe(true);
  });

  it('phát tool call theo kịch bản rồi trả lời thẳng ở lượt cuối', async () => {
    const fake = new FakeLlmProvider();
    fake.scriptToolTurns([
      {
        toolCalls: [{ name: 'rag_search', args: { query: 'quy chế bảo lưu' } }],
      },
      { content: 'Sinh viên được bảo lưu tối đa hai học kỳ.' },
    ]);

    const first = await fake.chatWithTools(
      [{ role: 'user', content: 'bảo lưu được mấy kỳ?' }],
      [searchTool],
    );
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]).toMatchObject({
      name: 'rag_search',
      id: 'fake-call-1',
      argsValid: true,
      args: { query: 'quy chế bảo lưu' },
    });
    expect(first.finishReason).toBe('tool_calls');

    const second = await fake.chatWithTools(
      [{ role: 'user', content: 'bảo lưu được mấy kỳ?' }],
      [searchTool],
    );
    expect(second.toolCalls).toHaveLength(0);
    expect(second.content).toBe('Sinh viên được bảo lưu tối đa hai học kỳ.');
  });

  it('kịch bản cạn → trả lời thẳng (extractive)', async () => {
    const fake = new FakeLlmProvider();
    const res = await fake.chatWithTools(
      [{ role: 'user', content: 'Câu một. Câu hai.' }],
      [searchTool],
    );
    expect(res.toolCalls).toHaveLength(0);
    expect(res.content).toBe('[fake] Câu một.');
  });

  it('argsValid=false khi kịch bản đưa args sai schema', async () => {
    const fake = new FakeLlmProvider();
    fake.scriptToolTurns([
      { toolCalls: [{ name: 'rag_search', args: { query: 42 } }] },
    ]);
    const res = await fake.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [searchTool],
    );
    expect(res.toolCalls[0]!.argsValid).toBe(false);
    expect(res.toolCalls[0]!.args).toEqual({ query: 42 });
  });
});

describe('properNouns (NER thô cho fake provider)', () => {
  it('rút được cụm từ viết hoa có dấu tiếng Việt', () => {
    const nouns = properNouns('Đại học Bách Khoa nằm ở thành phố Hà Nội.');
    expect(nouns.join(' | ')).toMatch(/Bách Khoa/);
    expect(nouns.join(' | ')).toMatch(/Hà Nội/);
  });
  it('tất định và bỏ trùng (case-insensitive)', () => {
    const a = properNouns('Công Ty ABC và Công Ty ABC hợp tác.');
    const b = properNouns('Công Ty ABC và Công Ty ABC hợp tác.');
    expect(a).toEqual(b);
    expect(a.length).toBe(1);
  });
});
