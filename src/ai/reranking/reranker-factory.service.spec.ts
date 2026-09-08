import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { NoopRerankerProvider } from './providers/noop-reranker.provider';
import { FakeRerankerProvider } from './providers/fake-reranker.provider';
import { LlmRerankerProvider } from './providers/llm-reranker.provider';
import { ApiRerankerProvider } from './providers/api-reranker.provider';
import { RerankerFactoryService } from './reranker-factory.service';

describe('RerankerFactoryService', () => {
  const noop = new NoopRerankerProvider();
  const fake = new FakeRerankerProvider();
  const llm = {
    name: 'llm',
    isConfigured: () => true,
  } as unknown as LlmRerankerProvider;
  const api = {
    name: 'api',
    isConfigured: () => true,
  } as unknown as ApiRerankerProvider;

  it('phân giải provider mặc định theo config rerank.provider', () => {
    const config = mockConfigService({ rerank: { provider: 'fake' } });
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.activeName).toBe('fake');
    expect(factory.create()).toBe(fake);
  });

  it('mặc định "none" (identity) khi không cấu hình', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.activeName).toBe('none');
    expect(factory.create()).toBe(noop);
  });

  it('đọc RERANK_PROVIDER từ env qua config', () => {
    const config = mockConfigService({}, { RERANK_PROVIDER: 'llm' });
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.activeName).toBe('llm');
    expect(factory.create()).toBe(llm);
  });

  it('cho phép override provider khi gọi create()', () => {
    const config = mockConfigService({ rerank: { provider: 'none' } });
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.create('llm')).toBe(llm);
    expect(factory.create('fake')).toBe(fake);
    expect(factory.create('none')).toBe(noop);
    expect(factory.create('api')).toBe(api);
  });

  it('phân giải provider "api" khi RERANK_PROVIDER=api', () => {
    const config = mockConfigService(
      {},
      {
        RERANK_PROVIDER: 'api',
        RERANK_BASE_URL: 'http://localhost:11435/v1',
        RERANK_MODEL: 'Qwen3-Reranker-0.6B',
      },
    );
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.activeName).toBe('api');
    expect(factory.create()).toBe(api);
  });

  it('ném ConfigError khi yêu cầu provider không hợp lệ', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(() => factory.create('invalid-provider')).toThrow(ConfigError);
  });

  it('all() trả về danh sách tất cả các provider đã đăng ký', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm, api);

    expect(factory.all()).toEqual([noop, fake, llm, api]);
  });
});
