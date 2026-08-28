import { normalizedTextHash, sha256 } from './hash.util';

describe('hash.util', () => {
  it('sha256 ổn định và khác nhau theo input', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    expect(sha256('abc')).toHaveLength(64);
  });

  it('normalizedTextHash bỏ qua khác biệt về khoảng trắng và hoa-thường', () => {
    expect(normalizedTextHash('Hello   World')).toBe(
      normalizedTextHash('hello world'),
    );
    expect(normalizedTextHash('  a\nb  ')).toBe(normalizedTextHash('a b'));
  });

  it('normalizedTextHash phân biệt nội dung thực sự khác nhau', () => {
    expect(normalizedTextHash('quyết định 123')).not.toBe(
      normalizedTextHash('quyết định 124'),
    );
  });
});
