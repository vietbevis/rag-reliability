import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { FixedSizeChunkerService } from './fixed-size-chunker.service';

function make(maxTokens = 40, overlapTokens = 8) {
  const config = mockConfigService({
    chunking: { maxTokens, minTokens: 8, overlapTokens },
  });
  return new FixedSizeChunkerService(config, new TokenCounterService());
}

describe('FixedSizeChunkerService (baseline)', () => {
  const longText = Array.from({ length: 60 }, (_, i) => `từ${i}`).join(' ');

  it('chia text dài thành nhiều chunk theo cửa sổ token', async () => {
    const chunks = await make(30).split({ text: longText });
    expect(chunks.length).toBeGreaterThan(1);
    const tokens = new TokenCounterService();
    for (const c of chunks) {
      expect(tokens.count(c.content)).toBeLessThanOrEqual(30 + 5);
    }
  });

  it('không dùng cấu trúc: không có heading/section', async () => {
    const chunks = await make().split({
      markdown: '# Bỏ qua heading này\n\nnội dung',
      text: longText,
    });
    expect(chunks.every((c) => c.heading === undefined)).toBe(true);
    expect(chunks[0]!.metadata.splitReason).toBe('fixed-window');
  });

  it('text ngắn -> 1 chunk', async () => {
    const chunks = await make(100).split({ text: 'ngắn gọn thôi' });
    expect(chunks).toHaveLength(1);
  });
});
