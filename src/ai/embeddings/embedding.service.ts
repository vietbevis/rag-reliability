import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { EmbeddingProviderName } from '../llm/llm-provider.enum';
import { EmbeddingFactoryService } from './embedding-factory.service';
import type {
  EmbeddingBatchResult,
  EmbeddingResult,
} from './embedding.interface';

/**
 * Loại đầu vào embedding — quyết định tiền tố bất đối xứng cho model họ E5.
 * `query` cho câu truy vấn người dùng, `passage` cho đoạn tài liệu được lập chỉ mục.
 */
export type EmbeddingInputType = 'query' | 'passage';

export interface EmbedOptions {
  provider?: EmbeddingProviderName;
  inputType?: EmbeddingInputType;
}

/**
 * Điểm vào embedding thống nhất cho lõi RAG. Độc lập với provider: đổi
 * `EMBEDDING_PROVIDER` là đổi back-end mà không cần sửa code (PROMPT §14).
 *
 * Áp tiền tố bất đối xứng ("query: " / "passage: ") cho model họ E5/GTE khi
 * `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_PASSAGE_PREFIX` được đặt, hoặc tự suy ra
 * khi tên model chứa "e5" (intfloat/multilingual-e5-large bắt buộc tiền tố này —
 * thiếu nó chất lượng truy hồi giảm mạnh mà không báo lỗi).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly queryPrefix: string;
  private readonly passagePrefix: string;

  constructor(
    private readonly factory: EmbeddingFactoryService,
    config: ConfigService<AppConfig, true>,
  ) {
    const emb = config.get('embedding', { infer: true });
    const model = this.safeModel();
    const autoE5 = /e5/i.test(model);

    this.queryPrefix = emb.queryPrefix || (autoE5 ? 'query: ' : '');
    this.passagePrefix = emb.passagePrefix || (autoE5 ? 'passage: ' : '');

    if (this.queryPrefix || this.passagePrefix) {
      this.logger.log(
        `Tiền tố embedding: query=${JSON.stringify(this.queryPrefix)} passage=${JSON.stringify(this.passagePrefix)} (model=${model})`,
      );
    }
  }

  private safeModel(): string {
    try {
      return this.factory.create().defaultModel;
    } catch {
      return '';
    }
  }

  get activeProvider(): EmbeddingProviderName {
    return this.factory.defaultProviderName;
  }

  get dimensions(): number {
    return this.factory.create().dimensions;
  }

  get activeModel(): string {
    return this.factory.create().defaultModel;
  }

  isConfigured(provider?: EmbeddingProviderName): boolean {
    return this.factory.create(provider).isConfigured();
  }

  private prefixFor(inputType?: EmbeddingInputType): string {
    if (inputType === 'query') return this.queryPrefix;
    if (inputType === 'passage') return this.passagePrefix;
    return '';
  }

  embed(text: string, opts: EmbedOptions = {}): Promise<EmbeddingResult> {
    const prefix = this.prefixFor(opts.inputType);
    return this.factory.create(opts.provider).embed(prefix + text);
  }

  embedBatch(
    texts: string[],
    opts: EmbedOptions = {},
  ): Promise<EmbeddingBatchResult> {
    const prefix = this.prefixFor(opts.inputType);
    const prepared = prefix ? texts.map((t) => prefix + t) : texts;
    return this.factory.create(opts.provider).embedBatch(prepared);
  }
}
