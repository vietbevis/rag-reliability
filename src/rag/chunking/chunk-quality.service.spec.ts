import { mockConfigService } from '../../config/config.mock';
import { ChunkQualityService } from './chunk-quality.service';

function make() {
  return new ChunkQualityService(
    mockConfigService({ chunking: { minTokens: 20, maxTokens: 100 } }),
  );
}

describe('ChunkQualityService', () => {
  it('chunk tốt: score cao, không cờ', () => {
    const r = make().assess({
      content:
        'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp.',
      tokenCount: 40,
      hasHeading: true,
    });
    expect(r.flags).toEqual([]);
    expect(r.score).toBe(1);
  });

  it('gắn cờ TOO_SHORT và MISSING_CONTEXT', () => {
    const r = make().assess({
      content: 'Quá ngắn.',
      tokenCount: 3,
      hasHeading: false,
    });
    expect(r.flags).toEqual(
      expect.arrayContaining(['TOO_SHORT', 'MISSING_CONTEXT']),
    );
    expect(r.score).toBeLessThan(1);
  });

  it('gắn cờ STARTS_MID_SENTENCE / ENDS_MID_SENTENCE', () => {
    const r = make().assess({
      content: 'và tiếp tục nội dung dang dở chưa kết thúc',
      tokenCount: 30,
      hasHeading: true,
    });
    expect(r.flags).toEqual(
      expect.arrayContaining(['STARTS_MID_SENTENCE', 'ENDS_MID_SENTENCE']),
    );
  });

  it('gắn cờ DUPLICATE với penalty lớn', () => {
    const r = make().assess({
      content: 'Nội dung này đủ dài để không bị coi là quá ngắn theo ngưỡng.',
      tokenCount: 40,
      hasHeading: true,
      isDuplicate: true,
    });
    expect(r.flags).toContain('DUPLICATE');
    expect(r.score).toBeLessThanOrEqual(0.5);
  });

  it('gắn cờ HIGH_NOISE', () => {
    const r = make().assess({
      content: '@@@ ~~~ ^^^ {}{}{} <<>><<>> €£¥§±×÷ ‡†•‰ @@@ ~~~',
      tokenCount: 30,
      hasHeading: true,
    });
    expect(r.flags).toContain('HIGH_NOISE');
  });
});
