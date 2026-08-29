import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ConfigError } from '../../common/errors';
import type { RerankerProvider } from './reranker.interface';
import { NoopRerankerProvider } from './providers/noop-reranker.provider';
import { FakeRerankerProvider } from './providers/fake-reranker.provider';
import { LlmRerankerProvider } from './providers/llm-reranker.provider';

export type RerankProviderName = 'none' | 'fake' | 'llm';

/**
 * Factory phân giải provider reranking dựa theo cấu hình hoặc tham số ghi đè.
 */
@Injectable()
export class RerankerFactoryService {
  private readonly registry: Record<string, RerankerProvider>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    noop: NoopRerankerProvider,
    fake: FakeRerankerProvider,
    llm: LlmRerankerProvider,
  ) {
    this.registry = {
      none: noop,
      fake: fake,
      llm: llm,
    };
  }

  /**
   * Tên provider đang active theo cấu hình.
   */
  get activeName(): RerankProviderName {
    return this.config.get('rerank', { infer: true }).provider;
  }

  /**
   * Tạo / lấy instance RerankerProvider tương ứng.
   */
  create(override?: string): RerankerProvider {
    const name = override ?? this.activeName;
    const impl = this.registry[name];
    if (!impl) {
      throw new ConfigError(`Unknown reranker provider: ${String(name)}`);
    }
    return impl;
  }

  /**
   * Danh sách tất cả provider đã đăng ký.
   */
  all(): RerankerProvider[] {
    return Object.values(this.registry);
  }
}
