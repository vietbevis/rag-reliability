import { LlmProvider } from './llm-provider.enum';
import { estimateCost, getModelPrice } from './pricing';

describe('pricing', () => {
  it('tính chi phí theo giá model đã biết', () => {
    // gpt-4o: 0.0025 / 1k input, 0.01 / 1k output
    const cost = estimateCost(LlmProvider.OPENAI, 'gpt-4o', 1000, 500);
    expect(cost).toBeCloseTo(0.0025 + 0.005, 6);
  });

  it('dùng giá mặc định của provider cho model chưa biết (không bao giờ 0 âm thầm)', () => {
    const price = getModelPrice(LlmProvider.ANTHROPIC, 'model-la-la-la');
    expect(price.inputPer1k).toBeGreaterThan(0);
  });

  it('provider custom mặc định chi phí 0', () => {
    expect(estimateCost(LlmProvider.CUSTOM, 'whatever', 10_000, 10_000)).toBe(
      0,
    );
  });

  it('làm tròn tới 6 chữ số thập phân', () => {
    const cost = estimateCost(
      LlmProvider.OPENAI,
      'text-embedding-3-small',
      1,
      0,
    );
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});
