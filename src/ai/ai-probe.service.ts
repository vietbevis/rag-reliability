import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors';
import { EmbeddingFactoryService } from './embeddings/embedding-factory.service';
import { LlmFactoryService } from './llm/llm-factory.service';
import { EmbeddingProviderName, LlmProvider } from './llm/llm-provider.enum';
import type { TestProviderDto } from './dto/test-provider.dto';

export interface ProviderProbeResult {
  provider: string;
  mode: 'chat' | 'embedding';
  ok: boolean;
  configured: boolean;
  latencyMs?: number;
  model?: string;
  tokens?: number;
  error?: { code: string; message: string };
}

const LLM_TO_EMBEDDING: Partial<Record<LlmProvider, EmbeddingProviderName>> = {
  [LlmProvider.OPENAI]: EmbeddingProviderName.OPENAI,
  [LlmProvider.GEMINI]: EmbeddingProviderName.GEMINI,
  [LlmProvider.CUSTOM]: EmbeddingProviderName.CUSTOM,
};

/**
 * Một vòng gọi thật tối thiểu tới provider. Dùng bởi `POST /ai/providers/test`
 * và (tuỳ chọn) health check. Không bao giờ ném lỗi — probe thất bại trả về
 * `{ ok: false }`, nên một provider chưa cấu hình không làm hỏng API.
 */
@Injectable()
export class AiProbeService {
  private readonly logger = new Logger(AiProbeService.name);

  constructor(
    private readonly llmFactory: LlmFactoryService,
    private readonly embeddingFactory: EmbeddingFactoryService,
  ) {}

  async test(dto: TestProviderDto): Promise<ProviderProbeResult> {
    const mode = dto.mode ?? 'chat';
    return mode === 'embedding'
      ? this.probeEmbedding(dto.provider)
      : this.probeChat(dto.provider, dto.model);
  }

  private async probeChat(
    provider: LlmProvider,
    model?: string,
  ): Promise<ProviderProbeResult> {
    const impl = this.llmFactory.create(provider);
    const base: ProviderProbeResult = {
      provider,
      mode: 'chat',
      ok: false,
      configured: impl.isConfigured(),
      model: model ?? impl.defaultModel,
    };
    if (!impl.isConfigured()) {
      return {
        ...base,
        error: { code: 'NOT_CONFIGURED', message: 'No credentials' },
      };
    }
    try {
      const res = await impl.chat(
        [{ role: 'user', content: 'Reply with the single word: pong' }],
        {
          model,
          maxTokens: 8,
          timeoutMs: 15_000,
          retryConfig: { maxRetries: 1 },
        },
      );
      return {
        ...base,
        ok: true,
        latencyMs: res.latencyMs,
        model: res.model,
        tokens: res.usage.totalTokens,
      };
    } catch (err) {
      return { ...base, error: this.toError(err) };
    }
  }

  private async probeEmbedding(
    llmProvider: LlmProvider,
  ): Promise<ProviderProbeResult> {
    const embProvider = LLM_TO_EMBEDDING[llmProvider];
    if (!embProvider) {
      return {
        provider: llmProvider,
        mode: 'embedding',
        ok: false,
        configured: false,
        error: {
          code: 'UNSUPPORTED',
          message: `${llmProvider} has no embedding backend`,
        },
      };
    }
    const impl = this.embeddingFactory.create(embProvider);
    const base: ProviderProbeResult = {
      provider: embProvider,
      mode: 'embedding',
      ok: false,
      configured: impl.isConfigured(),
      model: impl.defaultModel,
    };
    if (!impl.isConfigured()) {
      return {
        ...base,
        error: { code: 'NOT_CONFIGURED', message: 'No credentials' },
      };
    }
    try {
      const started = Date.now();
      const res = await impl.embed('connectivity probe');
      return {
        ...base,
        ok: res.vector.length === impl.dimensions,
        latencyMs: Date.now() - started,
        model: res.model,
        tokens: res.usage.totalTokens,
      };
    } catch (err) {
      return { ...base, error: this.toError(err) };
    }
  }

  private toError(err: unknown): { code: string; message: string } {
    if (err instanceof AppError) {
      return { code: err.code, message: err.message };
    }
    return {
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
