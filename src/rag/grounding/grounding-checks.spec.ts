import {
  looksLikeAbstention,
  contentTokens,
  lexicalGroundingRatio,
  resolveGroundingStatus,
  type GroundingResolveInput,
} from './grounding-checks';

describe('grounding-checks', () => {
  describe('looksLikeAbstention', () => {
    it('nhận diện các cụm STRONG dù answer dài', () => {
      const strongExamples = [
        'Theo phân tích chi tiết toàn bộ ngữ cảnh được cung cấp ở trên, ' +
          'tôi không tìm thấy thông tin nào liên quan trực tiếp đến câu hỏi.',
        'Tài liệu không đủ thông tin để trả lời.',
        'Tôi không thể trả lời câu hỏi này dựa trên tài liệu hiện có.',
        'Tôi không biết.',
        'insufficient_evidence',
        'insufficient evidence',
      ];

      for (const example of strongExamples) {
        expect(looksLikeAbstention(example)).toBe(true);
      }
    });

    it('nhận diện các cụm WEAK khi answer NGẮN', () => {
      const weakShort = [
        'Hiện tại không có thông tin về vấn đề này.',
        'Không đủ căn cứ xác định.',
        'Chưa có thông tin cập nhật.',
        'Chưa đủ thông tin để phản hồi.',
        'Ngữ cảnh không đề cập đến học phí.',
        'Tài liệu không đề cập đến thời gian thi.',
      ];

      for (const example of weakShort) {
        expect(looksLikeAbstention(example)).toBe(true);
      }
    });

    it('trả về true nếu answer rỗng hoặc chỉ toàn khoảng trắng', () => {
      expect(looksLikeAbstention('')).toBe(true);
      expect(looksLikeAbstention('   \n\t  ')).toBe(true);
    });

    it('KHÔNG coi câu trả lời bình thường có chứa từ "không" là abstention', () => {
      const normalAnswers = [
        'Sinh viên không được đăng ký học phần sau tuần thứ 2.',
        'Học phí năm học 2024 là 20 triệu đồng và không hoàn lại.',
        'Quy chế này không áp dụng cho sinh viên hệ liên thông.',
        'Thời gian nộp hồ sơ không muộn hơn ngày 15 hàng tháng.',
        'Hồ sơ đăng ký dự thi gồm bằng tốt nghiệp và giấy khám sức khỏe.',
      ];

      for (const answer of normalAnswers) {
        expect(looksLikeAbstention(answer)).toBe(false);
      }
    });

    it('FINDING 1: KHÔNG phạt oan câu trả lời hợp lệ chứa cụm WEAK nhưng DÀI', () => {
      // Kịch bản agy P8: câu trả lời đúng, có nội dung thực chất
      const validButLong = [
        'Quy chế chung không đề cập thời hạn cụ thể của việc bảo lưu kết quả ' +
          'học tập, mà giao cho từng khoa tự quy định trong quy định nội bộ ' +
          'của đơn vị mình, dựa trên đặc thù chương trình đào tạo.',
        'Văn bản không nêu rõ mức phạt cụ thể đối với hành vi này; thẩm quyền ' +
          'xử lý được giao cho hội đồng kỷ luật cấp khoa xem xét theo từng ' +
          'trường hợp và mức độ vi phạm thực tế của sinh viên.',
      ];

      for (const answer of validButLong) {
        expect(looksLikeAbstention(answer)).toBe(false);
      }
    });
  });

  describe('contentTokens', () => {
    it('bỏ stopword tiếng Việt và các token ngắn (< 2 ký tự)', () => {
      const text =
        'ở là và của các một những được cho trong sinh viên học phần';
      const tokens = contentTokens(text);

      expect(tokens.has('ở')).toBe(false); // < 2 ký tự
      expect(tokens.has('là')).toBe(false); // stopword
      expect(tokens.has('và')).toBe(false); // stopword
      expect(tokens.has('của')).toBe(false); // stopword
      expect(tokens.has('sinh')).toBe(true);
      expect(tokens.has('viên')).toBe(true);
      expect(tokens.has('học')).toBe(true);
      expect(tokens.has('phần')).toBe(true);
    });

    it('chuẩn hóa NFC và lowercase', () => {
      const text = 'ĐẠI HỌC Bách Khoa';
      const tokens = contentTokens(text);

      expect(tokens.has('đại')).toBe(true);
      expect(tokens.has('học')).toBe(true);
      expect(tokens.has('bách')).toBe(true);
      expect(tokens.has('khoa')).toBe(true);
    });

    it('trả về Set rỗng nếu chuỗi không có từ nội dung hợp lệ', () => {
      expect(contentTokens('')).toEqual(new Set());
      expect(contentTokens('là và của 1 a')).toEqual(new Set());
    });
  });

  describe('lexicalGroundingRatio', () => {
    it('trả về 1 nếu answer không có token nội dung nào', () => {
      expect(lexicalGroundingRatio('', 'Ngữ cảnh mẫu')).toBe(1);
      expect(lexicalGroundingRatio('là và của', 'Ngữ cảnh mẫu')).toBe(1);
    });

    it('trả về 1 khi tất cả token của answer đều có trong context', () => {
      const answer = 'Sinh viên đăng ký học phần';
      const context = 'Quy định sinh viên đăng ký học phần học kỳ 1';
      expect(lexicalGroundingRatio(answer, context)).toBe(1);
    });

    it('trả về 0 khi không có token nào của answer có trong context', () => {
      const answer = 'Học phí tăng cao';
      const context = 'Sinh viên thực tập tốt nghiệp';
      expect(lexicalGroundingRatio(answer, context)).toBe(0);
    });

    it('tính đúng tỷ lệ phần trăm và làm tròn 4 chữ số thập phân', () => {
      // answer có 3 tokens: ["bảo", "lưu", "kỳ"]
      // context chỉ có "bảo" -> 1/3 = 0.3333
      const answer = 'Bảo lưu kỳ';
      const context = 'Bảo đảm an toàn';
      expect(lexicalGroundingRatio(answer, context)).toBe(0.3333);
    });
  });

  describe('resolveGroundingStatus', () => {
    const baseInput: GroundingResolveInput = {
      llmStatus: 'GROUNDED',
      answer: 'Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ.',
      usedContextCount: 2,
      groundedSelfReport: true,
      lexicalRatio: 0.9,
      minRatio: 0.5,
      strict: false,
      answerTokenCount: 8,
    };

    describe('nhánh a: looksLikeAbstention', () => {
      it('hạ xuống INSUFFICIENT_EVIDENCE với reason answer_is_abstention (kể cả non-strict)', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          answer: 'Tôi không tìm thấy thông tin trong tài liệu.',
          strict: false,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'INSUFFICIENT_EVIDENCE',
          downgraded: true,
          regenerate: false,
          reason: 'answer_is_abstention',
        });
      });

      it('giữ downgraded = false nếu llmStatus vốn là INSUFFICIENT_EVIDENCE', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'INSUFFICIENT_EVIDENCE',
          answer: 'insufficient_evidence',
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'INSUFFICIENT_EVIDENCE',
          downgraded: false,
          regenerate: false,
          reason: 'answer_is_abstention',
        });
      });
    });

    describe('nhánh b: llmStatus grounded nhưng usedContextCount === 0', () => {
      it('chuyển GROUNDED thành INSUFFICIENT_EVIDENCE với reason grounded_but_no_citation', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          usedContextCount: 0,
          strict: false,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'INSUFFICIENT_EVIDENCE',
          downgraded: true,
          regenerate: false,
          reason: 'grounded_but_no_citation',
        });
      });

      it('chuyển PARTIALLY_GROUNDED thành INSUFFICIENT_EVIDENCE với reason grounded_but_no_citation', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'PARTIALLY_GROUNDED',
          usedContextCount: 0,
          strict: false,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'INSUFFICIENT_EVIDENCE',
          downgraded: true,
          regenerate: false,
          reason: 'grounded_but_no_citation',
        });
      });
    });

    describe('nhánh c: llmStatus === CONFLICTING_EVIDENCE', () => {
      it('giữ nguyên CONFLICTING_EVIDENCE không thay đổi', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'CONFLICTING_EVIDENCE',
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'CONFLICTING_EVIDENCE',
          downgraded: false,
          regenerate: false,
        });
      });
    });

    describe('nhánh d: [strict] llmStatus === GROUNDED và groundedSelfReport === false', () => {
      it('chuyển GROUNDED thành PARTIALLY_GROUNDED khi strict = true', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          groundedSelfReport: false,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'PARTIALLY_GROUNDED',
          downgraded: true,
          regenerate: false,
          reason: 'llm_self_report_ungrounded',
        });
      });

      it('không hạ status khi strict = false', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          groundedSelfReport: false,
          strict: false,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'GROUNDED',
          downgraded: false,
          regenerate: false,
        });
      });
    });

    describe('nhánh e: [strict] lexicalRatio < minRatio', () => {
      it('chuyển GROUNDED thành PARTIALLY_GROUNDED và regenerate = true khi strict = true', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          lexicalRatio: 0.3,
          minRatio: 0.5,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'PARTIALLY_GROUNDED',
          downgraded: true,
          regenerate: true,
          reason: 'low_lexical_grounding',
        });
      });

      it('giữ PARTIALLY_GROUNDED và regenerate = true (downgraded = false) khi strict = true', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'PARTIALLY_GROUNDED',
          lexicalRatio: 0.3,
          minRatio: 0.5,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'PARTIALLY_GROUNDED',
          downgraded: false,
          regenerate: true,
          reason: 'low_lexical_grounding',
        });
      });

      it('không regenerate hoặc hạ bậc khi strict = false dù lexicalRatio thấp', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          lexicalRatio: 0.2,
          minRatio: 0.5,
          strict: false,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'GROUNDED',
          downgraded: false,
          regenerate: false,
        });
      });

      it('FINDING 3: bỏ qua kiểm tra lexical khi answer quá ngắn (< 5 token)', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          answer: 'Hai học kỳ.',
          answerTokenCount: 3,
          lexicalRatio: 0.2,
          minRatio: 0.5,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'GROUNDED',
          downgraded: false,
          regenerate: false,
        });
      });
    });

    describe('nhánh f: mặc định', () => {
      it('giữ nguyên GROUNDED khi đáp ứng đầy đủ tiêu chí', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'GROUNDED',
          groundedSelfReport: true,
          lexicalRatio: 0.8,
          minRatio: 0.5,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'GROUNDED',
          downgraded: false,
          regenerate: false,
        });
      });

      it('giữ nguyên PARTIALLY_GROUNDED khi lexicalRatio >= minRatio', () => {
        const input: GroundingResolveInput = {
          ...baseInput,
          llmStatus: 'PARTIALLY_GROUNDED',
          lexicalRatio: 0.7,
          minRatio: 0.5,
          strict: true,
        };
        const res = resolveGroundingStatus(input);
        expect(res).toEqual({
          status: 'PARTIALLY_GROUNDED',
          downgraded: false,
          regenerate: false,
        });
      });
    });
  });
});
