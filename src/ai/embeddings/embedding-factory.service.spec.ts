import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { EmbeddingFactoryService } from './embedding-factory.service';
import { EmbeddingProviderName } from '../llm/llm-provider.enum';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import { CustomEmbeddingProvider } from './providers/custom-embedding.provider';
import { FakeEmbeddingProvider } from './providers/fake-embedding.provider';

function build(env: Record<string, string> = {}) {
  const config = mockConfigService({}, env);
  return new EmbeddingFactoryService(
    config,
    new OpenAiEmbeddingProvider(config),
    new GeminiEmbeddingProvider(config),
    new CustomEmbeddingProvider(config),
    new FakeEmbeddingProvider(config),
  );
}

describe('EmbeddingFactoryService', () => {
  it('trả về provider mặc định theo EMBEDDING_PROVIDER', () => {
    expect(build().create().provider).toBe(EmbeddingProviderName.OPENAI);
  });

  it('số chiều lấy từ EMBEDDING_DIMENSION', () => {
    expect(build({ EMBEDDING_DIMENSION: '768' }).create().dimensions).toBe(768);
  });

  it('đăng ký 4 provider embedding (gồm fake)', () => {
    expect(build().all()).toHaveLength(4);
  });

  it('provider fake luôn configured, số chiều theo EMBEDDING_DIMENSION', () => {
    const p = build({ EMBEDDING_DIMENSION: '768' }).create(
      EmbeddingProviderName.FAKE,
    );
    expect(p.isConfigured()).toBe(true);
    expect(p.dimensions).toBe(768);
  });

  it('ném ConfigError với provider không hợp lệ', () => {
    expect(() => build().create('nope' as EmbeddingProviderName)).toThrow(
      ConfigError,
    );
  });
});
