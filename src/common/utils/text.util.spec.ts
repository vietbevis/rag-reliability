import { toKeywordQuery } from './text.util';

describe('text.util', () => {
  describe('toKeywordQuery', () => {
    it('bỏ từ nghi vấn + hư từ, nối token nghĩa bằng "or"', () => {
      const q = toKeywordQuery(
        'Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?',
      );
      const terms = q.split(' or ');
      expect(terms).toEqual(
        expect.arrayContaining([
          'sinh',
          'viên',
          'bảo',
          'lưu',
          'kết',
          'quả',
          'học',
          'tập',
          'tối',
          'đa',
          'kỳ',
        ]),
      );
      expect(q).not.toContain('mấy');
      expect(q).not.toContain('được');
      expect(q).toContain(' or ');
    });

    it('loại cụm nghi vấn nhiều từ', () => {
      expect(toKeywordQuery('Thủ tục phúc khảo như thế nào?')).not.toMatch(
        /thế|nào/,
      );
      expect(toKeywordQuery('Học phí là bao nhiêu?')).not.toMatch(/bao|nhiêu/);
    });

    it('giữ mã văn bản / số quyết định nguyên vẹn', () => {
      expect(toKeywordQuery('Quyết định 123/QĐ-ĐHQG quy định gì?')).toContain(
        '123/qđ-đhqg',
      );
    });

    it('query toàn hư từ -> chuỗi rỗng', () => {
      expect(toKeywordQuery('có phải không?')).toBe('');
      expect(toKeywordQuery('   ')).toBe('');
    });
  });
});
