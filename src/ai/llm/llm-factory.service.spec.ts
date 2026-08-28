import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { LlmFactoryService } from './llm-factory.service';
import { LlmProvider } from './llm-provider.enum';
import { OpenAiLlmProvider } from './providers/openai-llm.provider';
import { GeminiLlmProvider } from './providers/gemini-llm.provider';
import { AnthropicLlmProvider } from './providers/anthropic-llm.provider';
import { CustomLlmProvider } from './providers/custom-llm.provider';

function build(env: Record<string, string> = {}) {
  const config = mockConfigService({}, env);
  return new LlmFactoryService(
    config,
    new OpenAiLlmProvider(config),
    new GeminiLlmProvider(config),
    new AnthropicLlmProvider(config),
    new CustomLlmProvider(config),
  );
}

describe('LlmFactoryService', () => {
  it('trả về provider mặc định theo LLM_PROVIDER', () => {
    expect(build().create().provider).toBe(LlmProvider.OPENAI);
    expect(
      build({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' }).create()
        .provider,
    ).toBe(LlmProvider.ANTHROPIC);
  });

  it('cho phép yêu cầu provider cụ thể để benchmark', () => {
    expect(build().create(LlmProvider.GEMINI).provider).toBe(
      LlmProvider.GEMINI,
    );
  });

  it('đăng ký đủ 4 provider', () => {
    expect(build().all()).toHaveLength(4);
  });

  it('isConfigured phản ánh việc có credentials', () => {
    const f = build();
    expect(f.create(LlmProvider.OPENAI).isConfigured()).toBe(true);
    expect(f.create(LlmProvider.GEMINI).isConfigured()).toBe(false);
  });

  it('ném ConfigError với provider không hợp lệ', () => {
    expect(() => build().create('nope' as LlmProvider)).toThrow(ConfigError);
  });
});
