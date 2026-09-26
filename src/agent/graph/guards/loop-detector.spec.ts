import { checkLoop, toolCallKey } from './loop-detector';

/** Dựng bản đồ đếm như `toolInvocations` trong state. */
function counts(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of calls) {
    const k = toolCallKey(c.name, c.args);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe('checkLoop', () => {
  it('đúng input lặp lại đủ threshold lần → chặn', () => {
    const call = { name: 'rag__search', args: { query: 'a b c' } };
    expect(checkLoop(call, counts([call]), 2).blocked).toBe(false);
    expect(checkLoop(call, counts([call, call]), 2).blocked).toBe(true);
  });

  it('query diễn đạt lại (đảo từ, đổi topK/strategy) được tính là lặp', () => {
    const prior = counts([
      {
        name: 'rag__search',
        args: {
          query:
            'quy chế đào tạo HUST 2023 đăng ký tín chỉ học kỳ chính học kỳ hè tối đa tối thiểu',
          topK: 10,
          strategy: 'hybrid',
        },
      },
      {
        name: 'rag__search',
        args: {
          query:
            'quy chế đào tạo HUST 2023 đăng ký tối đa tối thiểu tín chỉ học kỳ chính học kỳ hè',
          topK: 6,
        },
      },
    ]);
    const next = {
      name: 'rag__search',
      args: {
        query:
          'HUST quy chế đào tạo 2023: tín chỉ tối đa, tối thiểu học kỳ chính và học kỳ hè',
        topK: 8,
      },
    };
    expect(checkLoop(next, prior, 2).blocked).toBe(true);
  });

  it('query khác ý (chủ đề khác) KHÔNG bị tính là lặp', () => {
    const prior = counts([
      { name: 'rag__search', args: { query: 'HUST 2023 cảnh báo học tập' } },
      {
        name: 'rag__search',
        args: { query: 'HUST 2023 cảnh báo học tập mức 1' },
      },
    ]);
    const next = {
      name: 'rag__search',
      args: { query: 'HUST 2023 điều kiện xét tốt nghiệp kỹ sư' },
    };
    expect(checkLoop(next, prior, 2).blocked).toBe(false);
  });

  it('tool khác tên không tính chung', () => {
    const prior = counts([
      { name: 'rag__search', args: { query: '3*4 + 4*3.5' } },
      { name: 'rag__search', args: { query: '3*4 + 4*3.5' } },
    ]);
    const next = {
      name: 'calculator__calculate',
      args: { expression: '3*4 + 4*3.5' },
    };
    expect(checkLoop(next, prior, 2).blocked).toBe(false);
  });
});
