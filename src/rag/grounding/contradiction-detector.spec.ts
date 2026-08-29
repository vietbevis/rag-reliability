import {
  detectClaimChunkContradiction,
  detectContextMutualContradiction,
} from './contradiction-detector';

describe('contradiction-detector', () => {
  describe('detectClaimChunkContradiction', () => {
    it('claim phủ định trong khi chunk khẳng định -> mâu thuẫn (contradicts = true)', () => {
      const claim = 'Sinh viên không được phép bảo lưu kết quả học tập';
      const chunk =
        'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(true);
      expect(res.reason).toContain('từ phủ định');
    });

    it('claim khẳng định trong khi chunk phủ định -> mâu thuẫn', () => {
      const claim = 'Nhà trường cho phép rút hồ sơ sau ngày bắt đầu học';
      const chunk =
        'Nhà trường không cho phép rút hồ sơ sau ngày bắt đầu học kỳ mới.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(true);
    });

    it('claim mâu thuẫn con số theo cùng danh từ/đơn vị -> mâu thuẫn', () => {
      const claim = 'Thời gian bảo lưu tối đa là 3 học kỳ';
      const chunk =
        'Quy chế đào tạo nêu rõ thời gian bảo lưu tối đa là 2 học kỳ liên tiếp.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(true);
      expect(res.reason).toContain('học kỳ');
    });

    it('claim và chunk cùng quan điểm số liệu -> không mâu thuẫn', () => {
      const claim = 'Sinh viên được bảo lưu 2 học kỳ';
      const chunk =
        'Sinh viên được phép xin bảo lưu kết quả 2 học kỳ theo quy chế.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(false);
    });

    it('claim và chunk không liên quan (độ phủ thấp) -> không mâu thuẫn', () => {
      const claim = 'Thời tiết hôm nay không mưa';
      const chunk = 'Lịch thi kết thúc học phần được công bố vào tuần sau.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(false);
    });

    // Hồi quy [P0]: chunk chứa CẢ điều cho phép lẫn điều cấm (gộp nhiều điều
    // khoản) không được coi là mâu thuẫn với claim khẳng định.
    it('chunk chứa cả "được phép" lẫn "không được" -> không mâu thuẫn với claim khẳng định', () => {
      const claim =
        'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp';
      const chunk =
        'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ. Trong thời gian bảo lưu, sinh viên không được đăng ký học phần và không được dự thi.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(false);
    });

    // "không được phép X" không được tính nhầm thành khẳng định vì chứa "được phép".
    it('phân biệt "không được phép" với "được phép"', () => {
      const claim = 'Sinh viên không được phép chuyển ngành trong năm đầu';
      const chunk = 'Sinh viên được phép chuyển ngành trong năm đầu tiên.';
      const res = detectClaimChunkContradiction(claim, chunk);
      expect(res.contradicts).toBe(true);
    });
  });

  describe('detectContextMutualContradiction', () => {
    it('phát hiện mâu thuẫn số liệu giữa 2 chunk có ngữ cảnh chung', () => {
      const chunks = [
        {
          chunkId: 'chk-1',
          content:
            'Quy định đào tạo năm 2024: sinh viên được bảo lưu tối đa 2 học kỳ.',
        },
        {
          chunkId: 'chk-2',
          content:
            'Quy định đào tạo sửa đổi: sinh viên được bảo lưu tối đa 1 học kỳ.',
        },
      ];
      const res = detectContextMutualContradiction(chunks);
      expect(res.hasConflict).toBe(true);
      expect(res.conflictingChunkIds).toEqual(['chk-1', 'chk-2']);
      expect(res.reason).toContain('học kỳ');
    });

    it('các chunk đồng nhất số liệu hoặc khác chủ đề -> không mâu thuẫn', () => {
      const chunks = [
        {
          chunkId: 'chk-1',
          content: 'Học phí chương trình chuẩn là 20 triệu đồng.',
        },
        {
          chunkId: 'chk-2',
          content:
            'Sinh viên phải tích lũy tối thiểu 120 tín chỉ để tốt nghiệp.',
        },
      ];
      const res = detectContextMutualContradiction(chunks);
      expect(res.hasConflict).toBe(false);
    });
  });
});
