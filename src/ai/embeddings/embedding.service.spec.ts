import { mockConfigService } from '../../config/config.mock';
import { EmbeddingFactoryService } from './embedding-factory.service';
import { EmbeddingService } from './embedding.service';

function build(
  env: Record<string, string> = {},
  defaultModel = 'text-embedding-3-small',
) {
  const embed = jest.fn().mockResolvedValue({
    vector: [0.1],
    usage: {
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
      estimatedCost: 0,
    },
    model: defaultModel,
  });
  const embedBatch = jest.fn().mockResolvedValue({
    vectors: [[0.1]],
    usage: {
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
      estimatedCost: 0,
    },
    model: defaultModel,
  });
  const impl = { embed, embedBatch, defaultModel, dimensions: 1024 };
  const factory = {
    create: () => impl,
    defaultProviderName: 'custom',
  } as unknown as EmbeddingFactoryService;
  const config = mockConfigService({}, env);
  return { svc: new EmbeddingService(factory, config), embed, embedBatch };
}

describe('EmbeddingService prefix', () => {
  it('không prefix cho model không phải E5', async () => {
    const { svc, embed } = build();
    await svc.embed('câu hỏi', { inputType: 'query' });
    expect(embed).toHaveBeenCalledWith('câu hỏi');
  });

  it('tự suy ra "query: "/"passage: " khi tên model chứa e5', async () => {
    const { svc, embed, embedBatch } = build(
      {},
      'intfloat/multilingual-e5-large',
    );
    await svc.embed('câu hỏi', { inputType: 'query' });
    expect(embed).toHaveBeenCalledWith('query: câu hỏi');

    await svc.embedBatch(['đoạn A', 'đoạn B'], { inputType: 'passage' });
    expect(embedBatch).toHaveBeenCalledWith([
      'passage: đoạn A',
      'passage: đoạn B',
    ]);
  });

  it('tôn trọng EMBEDDING_QUERY_PREFIX / EMBEDDING_PASSAGE_PREFIX tường minh', async () => {
    const { svc, embed } = build({
      EMBEDDING_QUERY_PREFIX: 'Q> ',
      EMBEDDING_PASSAGE_PREFIX: 'P> ',
    });
    await svc.embed('x', { inputType: 'query' });
    expect(embed).toHaveBeenCalledWith('Q> x');
  });

  it('không inputType -> không prefix kể cả với E5', async () => {
    const { svc, embed } = build({}, 'multilingual-e5-large');
    await svc.embed('probe');
    expect(embed).toHaveBeenCalledWith('probe');
  });
});
