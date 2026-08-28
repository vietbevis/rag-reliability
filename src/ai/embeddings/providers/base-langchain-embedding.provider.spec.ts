import type { Embeddings } from '@langchain/core/embeddings';
import { EmbeddingError } from '../../../common/errors';
import { EmbeddingProviderName } from '../../llm/llm-provider.enum';
import { BaseLangChainEmbeddingProvider } from './base-langchain-embedding.provider';

class FakeEmbeddingProvider extends BaseLangChainEmbeddingProvider {
  readonly provider = EmbeddingProviderName.OPENAI;
  readonly defaultModel = 'fake-embed';
  constructor(
    private readonly client: Embeddings | null,
    dimensions = 3,
    batchSize = 2,
  ) {
    super({
      timeoutMs: 1000,
      maxRetries: 1,
      retryBaseDelayMs: 1,
      batchSize,
      dimensions,
    });
  }
  protected getClient(): Embeddings | null {
    return this.client;
  }
}

const vec = (n: number) => Array.from({ length: n }, () => Math.random());

function fakeClient(embedDocuments: jest.Mock): Embeddings {
  return { embedDocuments, embedQuery: jest.fn() } as unknown as Embeddings;
}

describe('BaseLangChainEmbeddingProvider', () => {
  it('chia input thành nhiều lô theo batchSize', async () => {
    const embedDocuments = jest
      .fn()
      .mockImplementation((texts: string[]) => texts.map(() => vec(3)));
    const provider = new FakeEmbeddingProvider(
      fakeClient(embedDocuments),
      3,
      2,
    );

    const res = await provider.embedBatch(['a', 'b', 'c', 'd', 'e']);

    expect(res.vectors).toHaveLength(5);
    expect(embedDocuments).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  it('ném EmbeddingError khi số chiều không khớp', async () => {
    const provider = new FakeEmbeddingProvider(
      fakeClient(jest.fn().mockResolvedValue([vec(768)])),
      1536,
    );
    await expect(provider.embed('x')).rejects.toBeInstanceOf(EmbeddingError);
  });

  it('ném EmbeddingError AUTH khi chưa cấu hình', async () => {
    const provider = new FakeEmbeddingProvider(null);
    await expect(provider.embedBatch(['x'])).rejects.toBeInstanceOf(
      EmbeddingError,
    );
  });

  it('trả về rỗng cho input rỗng, không gọi client', async () => {
    const embedDocuments = jest.fn();
    const provider = new FakeEmbeddingProvider(fakeClient(embedDocuments));
    const res = await provider.embedBatch([]);
    expect(res.vectors).toEqual([]);
    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it('retry lỗi tạm thời của client', async () => {
    const embedDocuments = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue([vec(3)]);
    const provider = new FakeEmbeddingProvider(
      fakeClient(embedDocuments),
      3,
      5,
    );
    const res = await provider.embed('x');
    expect(res.vector).toHaveLength(3);
    expect(embedDocuments).toHaveBeenCalledTimes(2);
  });
});
