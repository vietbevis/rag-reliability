import {
  claimLeaked,
  factPresent,
  forbiddenClaimRate,
  normalizeText,
  requiredFactRecall,
} from './fact-metrics';

describe('fact-metrics', () => {
  it('normalizeText bỏ dấu + hạ chữ thường + gộp khoảng trắng', () => {
    expect(normalizeText('Phòng  Đào Tạo')).toBe('phong dao tao');
  });

  it('factPresent khớp không dấu và theo độ phủ token', () => {
    const answer =
      'Nộp cho phòng đào tạo trước ít nhất mười lăm ngày làm việc.';
    expect(factPresent(answer, 'phòng đào tạo')).toBe(true);
    expect(factPresent(answer, 'phong dao tao')).toBe(true);
    expect(factPresent(answer, 'mười lăm ngày làm việc')).toBe(true);
    expect(factPresent(answer, 'ba mươi ngày')).toBe(false);
  });

  it('requiredFactRecall: [] → null, thiếu fact → < 1', () => {
    expect(requiredFactRecall('bất kỳ', [])).toBeNull();
    expect(requiredFactRecall(null, ['x'])).toBe(0);
    const ans = 'Khoa duyệt trước, sau đó Phòng Đào tạo duyệt.';
    expect(
      requiredFactRecall(ans, ['Khoa duyệt trước', 'Phòng Đào tạo duyệt']),
    ).toBe(1);
    expect(
      requiredFactRecall(ans, ['Khoa duyệt trước', 'Học viện duyệt cuối']),
    ).toBe(0.5);
  });

  it('claimLeaked STRICT: khớp gần nguyên văn, KHÔNG dính câu phủ định', () => {
    // câu phủ định chứa mọi token của forbidden claim nhưng KHÔNG lộ
    expect(
      claimLeaked(
        'Sinh viên KHÔNG được xét học bổng vì bị khiển trách.',
        'vẫn được xét học bổng',
      ),
    ).toBe(false);
    // lộ thật
    expect(
      claimLeaked(
        'Như vậy sinh viên vẫn được xét học bổng bình thường.',
        'vẫn được xét học bổng',
      ),
    ).toBe(true);
    expect(
      claimLeaked('Hệ thống dùng PostgreSQL 16.', 'hệ thống dùng MongoDB'),
    ).toBe(false);
  });

  it('forbiddenClaimRate: lộ claim cấm → > 0, phủ định → 0', () => {
    expect(forbiddenClaimRate('abc', [])).toBeNull();
    expect(
      forbiddenClaimRate('Vì hệ thống dùng MongoDB nên cần sharding.', [
        'hệ thống dùng MongoDB',
      ]),
    ).toBe(1);
    expect(
      forbiddenClaimRate('Không, sinh viên vẫn được xét học bổng là sai.', [
        'sinh viên tự duyệt đơn',
      ]),
    ).toBe(0);
  });
});
