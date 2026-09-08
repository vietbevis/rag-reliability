import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { mockConfigService } from '../../../config/config.mock';
import type { ChatMessage, LLMOptions } from '../llm.interface';
import { CustomLlmProvider } from './custom-llm.provider';

const config = mockConfigService(
  {},
  {
    LLM_PROVIDER: 'custom',
    CUSTOM_LLM_BASE_URL: 'https://api.example.test/v1',
    CUSTOM_LLM_MODEL: 'some-model',
    EMBEDDING_PROVIDER: 'custom',
    CUSTOM_EMBEDDING_BASE_URL: 'https://api.example.test/v1',
    CUSTOM_EMBEDDING_MODEL: 'e5',
  },
);

class Probe extends CustomLlmProvider {
  peek(o?: LLMOptions): (BaseChatModel & { modelKwargs?: unknown }) | null {
    return this.getModel(o);
  }
  prep(messages: ChatMessage[], o: LLMOptions): ChatMessage[] {
    return this.prepareMessages(messages, o);
  }
}

describe('CustomLlmProvider — tắt reasoning', () => {
  const probe = new Probe(config);

  const kwargs = (o?: LLMOptions): Record<string, unknown> =>
    (probe.peek(o)?.modelKwargs ?? {}) as Record<string, unknown>;

  it('mặc định KHÔNG có tham số tắt thinking', () => {
    expect(kwargs({})).not.toHaveProperty('enable_thinking');
  });

  it('reasoning:false → gửi enable_thinking:false, KHÔNG gửi reasoning_effort', () => {
    const k = kwargs({ reasoning: false });
    expect(k).toMatchObject({ enable_thinking: false });
    // api.b.ai (2026-09) từ chối reasoning_effort:'none' — không được gửi lại.
    expect(k).not.toHaveProperty('reasoning_effort');
  });

  it('reasoning:true → không có tham số tắt thinking', () => {
    expect(kwargs({ reasoning: true })).not.toHaveProperty('enable_thinking');
  });
});

describe('CustomLlmProvider — chèn /no_think cho Qwen3', () => {
  const qwenConfig = mockConfigService(
    {},
    {
      LLM_PROVIDER: 'custom',
      CUSTOM_LLM_BASE_URL: 'http://localhost:11434/v1',
      CUSTOM_LLM_MODEL: 'qwen3:8b',
      EMBEDDING_PROVIDER: 'custom',
      CUSTOM_EMBEDDING_BASE_URL: 'http://localhost:11434/v1',
      CUSTOM_EMBEDDING_MODEL: 'bge-m3',
    },
  );
  const probe = new Probe(qwenConfig);
  const msgs: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'câu hỏi' },
  ];

  it('reasoning:false + model qwen3 → chèn /no_think vào message cuối', () => {
    const out = probe.prep(msgs, { reasoning: false });
    expect(out[1]?.content).toBe('câu hỏi /no_think');
    expect(out[0]?.content).toBe('system prompt');
  });

  it('không lặp lại /no_think nếu đã có', () => {
    const out = probe.prep([{ role: 'user', content: 'x /no_think' }], {
      reasoning: false,
    });
    expect(out[0]?.content).toBe('x /no_think');
  });

  it('reasoning không phải false → giữ nguyên', () => {
    expect(probe.prep(msgs, {})).toBe(msgs);
    expect(probe.prep(msgs, { reasoning: true })).toBe(msgs);
  });

  it('model không phải qwen3 → giữ nguyên dù reasoning:false', () => {
    const out = probe.prep(msgs, { reasoning: false, model: 'qwen2.5:7b' });
    expect(out).toBe(msgs);
  });
});
