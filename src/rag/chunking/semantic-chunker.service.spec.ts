import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import type { EmbeddingService } from '../../ai/embeddings/embedding.service';
import {
  SemanticChunkerService,
  splitSentences,
} from './semantic-chunker.service';

function build(opts: { configured?: boolean; vectors?: number[][] } = {}) {
  const config = mockConfigService({
    chunking: {
      strategy: 'semantic',
      maxTokens: 120,
      minTokens: 8,
      semanticBreakpointPercentile: 80,
      semanticBufferSize: 1,
    },
  });
  const embedBatch = jest.fn((texts: string[]) =>
    Promise.resolve({
      vectors: opts.vectors ?? texts.map((_t, i) => (i < 3 ? [1, 0] : [0, 1])),
      usage: {
        inputTokens: 1,
        outputTokens: 0,
        totalTokens: 1,
        estimatedCost: 0,
      },
      model: 'fake',
    }),
  );
  const embeddings = {
    isConfigured: () => opts.configured ?? true,
    embedBatch,
  } as unknown as EmbeddingService;
  return {
    svc: new SemanticChunkerService(
      config,
      new TokenCounterService(),
      embeddings,
    ),
    embedBatch,
  };
}

describe('SemanticChunkerService', () => {
  it('splitSentences tách theo dấu câu + xuống dòng, giữ heading', () => {
    const s = splitSentences('# Điều 1\nCâu một. Câu hai!\nCâu ba?');
    expect(s).toEqual(['# Điều 1', 'Câu một.', 'Câu hai!', 'Câu ba?']);
  });

  it('cắt tại ranh giới ngữ nghĩa (nhóm câu 1-3 vs 4-6)', async () => {
    const { svc, embedBatch } = build({
      vectors: [
        [1, 0],
        [1, 0],
        [1, 0],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
    });
    const text =
      'Sinh viên được bảo lưu tối đa hai học kỳ. Đơn nộp tại phòng đào tạo. ' +
      'Thời hạn nộp là mười lăm ngày.\n' +
      'Học phí học kỳ chính là hai mươi triệu. Sinh viên đóng qua ngân hàng. ' +
      'Hạn đóng là cuối tháng chín.';
    const chunks = await svc.split({ text });
    expect(embedBatch).toHaveBeenCalledTimes(1);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.content).toContain('bảo lưu');
    expect(chunks[chunks.length - 1]!.content).toContain('Học phí');
    expect(chunks[0]!.metadata.splitReason).toBe('semantic-breakpoint');
  });

  it('provider embedding chưa cấu hình -> fallback đóng gói đoạn, KHÔNG gọi embed', async () => {
    const { svc, embedBatch } = build({ configured: false });
    const chunks = await svc.split({
      text: 'Đoạn một có nội dung.\n\nĐoạn hai khác biệt.\n\nĐoạn ba nữa. Câu thêm.',
    });
    expect(embedBatch).not.toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.metadata.splitReason).toBe('semantic-fallback-pack');
  });

  it('lỗi embedBatch -> fallback, không ném', async () => {
    const config = mockConfigService({ chunking: { strategy: 'semantic' } });
    const embeddings = {
      isConfigured: () => true,
      embedBatch: jest.fn().mockRejectedValue(new Error('ollama down')),
    } as unknown as EmbeddingService;
    const svc = new SemanticChunkerService(
      config,
      new TokenCounterService(),
      embeddings,
    );
    const chunks = await svc.split({
      text: 'Câu một dài. Câu hai dài. Câu ba dài. Câu bốn dài. Câu năm dài.',
    });
    expect(chunks[0]!.metadata.splitReason).toBe(
      'semantic-fallback-embed-error',
    );
  });
});
