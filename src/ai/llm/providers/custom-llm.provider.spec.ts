import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { mockConfigService } from '../../../config/config.mock';
import type { LLMOptions } from '../llm.interface';
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
}

describe('CustomLlmProvider — tắt reasoning', () => {
  const probe = new Probe(config);

  const kwargs = (o?: LLMOptions): Record<string, unknown> =>
    (probe.peek(o)?.modelKwargs ?? {}) as Record<string, unknown>;

  it('mặc định KHÔNG có tham số tắt thinking', () => {
    expect(kwargs({})).not.toHaveProperty('reasoning_effort');
  });

  it('reasoning:false → gửi kèm reasoning_effort/enable_thinking', () => {
    expect(kwargs({ reasoning: false })).toMatchObject({
      reasoning_effort: 'none',
      enable_thinking: false,
    });
  });

  it('reasoning:true → không có tham số tắt thinking', () => {
    expect(kwargs({ reasoning: true })).not.toHaveProperty('reasoning_effort');
  });
});
