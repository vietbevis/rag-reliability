import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { EmbeddingFactoryService } from './embedding-factory.service';
import { EmbeddingProviderName } from '../llm/llm-provider.enum';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import { CustomEmbeddingProvider } from './providers/custom-embedding.provider';

function build(env: Record<string, string> = {}) {
  const config = mockConfigService({}, env);
  return new EmbeddingFactoryService(
    config,
    new OpenAiEmbeddingProvider(config),
    new GeminiEmbeddingProvider(config),
    new CustomEmbeddingProvider(config),
  );
}

describe('EmbeddingFactoryService', () => {
  it('trả về provider mặc định theo EMBEDDING_PROVIDER', () => {
    expect(build().create().provider).toBe(EmbeddingProviderName.OPENAI);
  });

  it('số chiều lấy từ EMBEDDING_DIMENSION', () => {
    expect(build({ EMBEDDING_DIMENSION: '768' }).create().dimensions).toBe(768);
  });

  it('đăng ký 3 provider embedding', () => {
    expect(build().all()).toHaveLength(3);
  });

  it('ném ConfigError với provider không hợp lệ', () => {
    expect(() => build().create('nope' as EmbeddingProviderName)).toThrow(
      ConfigError,
    );
  });
});
