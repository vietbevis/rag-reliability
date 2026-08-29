import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { NoopRerankerProvider } from './providers/noop-reranker.provider';
import { FakeRerankerProvider } from './providers/fake-reranker.provider';
import { LlmRerankerProvider } from './providers/llm-reranker.provider';
import { RerankerFactoryService } from './reranker-factory.service';

describe('RerankerFactoryService', () => {
  const noop = new NoopRerankerProvider();
  const fake = new FakeRerankerProvider();
  const llm = {
    name: 'llm',
    isConfigured: () => true,
  } as unknown as LlmRerankerProvider;

  it('phân giải provider mặc định theo config rerank.provider', () => {
    const config = mockConfigService({ rerank: { provider: 'fake' } });
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(factory.activeName).toBe('fake');
    expect(factory.create()).toBe(fake);
  });

  it('mặc định "none" (identity) khi không cấu hình', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(factory.activeName).toBe('none');
    expect(factory.create()).toBe(noop);
  });

  it('đọc RERANK_PROVIDER từ env qua config', () => {
    const config = mockConfigService({}, { RERANK_PROVIDER: 'llm' });
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(factory.activeName).toBe('llm');
    expect(factory.create()).toBe(llm);
  });

  it('cho phép override provider khi gọi create()', () => {
    const config = mockConfigService({ rerank: { provider: 'none' } });
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(factory.create('llm')).toBe(llm);
    expect(factory.create('fake')).toBe(fake);
    expect(factory.create('none')).toBe(noop);
  });

  it('ném ConfigError khi yêu cầu provider không hợp lệ', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(() => factory.create('invalid-provider')).toThrow(ConfigError);
  });

  it('all() trả về danh sách tất cả các provider đã đăng ký', () => {
    const config = mockConfigService();
    const factory = new RerankerFactoryService(config, noop, fake, llm);

    expect(factory.all()).toEqual([noop, fake, llm]);
  });
});
