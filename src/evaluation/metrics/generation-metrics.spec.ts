import {
  abstentionCorrect,
  citationAccuracy,
  claimLevelHallucinationRate,
  faithfulnessScore,
  hallucinationRateProxy,
  isAbstained,
  meanBool,
  meanIgnoringNull,
  type CaseOutcome,
} from './generation-metrics';

describe('generation-metrics', () => {
  describe('isAbstained', () => {
    it('chỉ INSUFFICIENT_EVIDENCE là abstain', () => {
      expect(isAbstained('INSUFFICIENT_EVIDENCE')).toBe(true);
      expect(isAbstained('GROUNDED')).toBe(false);
      expect(isAbstained('ERROR')).toBe(false);
    });
  });

  describe('abstentionCorrect', () => {
    it('answerable: đúng khi KHÔNG abstain và không lỗi', () => {
      expect(abstentionCorrect(true, 'GROUNDED')).toBe(true);
      expect(abstentionCorrect(true, 'PARTIALLY_GROUNDED')).toBe(true);
      expect(abstentionCorrect(true, 'INSUFFICIENT_EVIDENCE')).toBe(false);
      expect(abstentionCorrect(true, 'ERROR')).toBe(false);
    });
    it('unanswerable: đúng chỉ khi abstain', () => {
      expect(abstentionCorrect(false, 'INSUFFICIENT_EVIDENCE')).toBe(true);
      expect(abstentionCorrect(false, 'GROUNDED')).toBe(false);
      expect(abstentionCorrect(false, 'ERROR')).toBe(false);
    });
  });

  describe('citationAccuracy', () => {
    it('không có gold document -> null', () => {
      expect(citationAccuracy([{ documentId: 'a' }], [])).toBeNull();
    });
    it('có gold nhưng không citation -> 0', () => {
      expect(citationAccuracy([], ['a'])).toBe(0);
    });
    it('tỉ lệ citation trỏ đúng tài liệu gold', () => {
      expect(
        citationAccuracy(
          [{ documentId: 'a' }, { documentId: 'b' }, { documentId: 'x' }],
          ['a', 'b'],
        ),
      ).toBeCloseTo(2 / 3, 4);
    });
  });

  describe('hallucinationRateProxy', () => {
    const cases: CaseOutcome[] = [
      // unanswerable mà vẫn trả lời -> bịa
      { answerable: false, status: 'GROUNDED', answerCorrectness: null },
      // unanswerable, abstain đúng -> ok
      {
        answerable: false,
        status: 'INSUFFICIENT_EVIDENCE',
        answerCorrectness: null,
      },
      // answerable, trả lời sai hẳn -> bịa
      { answerable: true, status: 'GROUNDED', answerCorrectness: 0.1 },
      // answerable, trả lời đúng -> ok
      { answerable: true, status: 'GROUNDED', answerCorrectness: 0.9 },
    ];
    it('đếm case bịa / tổng case', () => {
      expect(hallucinationRateProxy(cases)).toBe(0.5);
    });
    it('rỗng -> 0', () => {
      expect(hallucinationRateProxy([])).toBe(0);
    });
  });

  describe('faithfulnessScore & claimLevelHallucinationRate', () => {
    it('toàn bộ claim supported -> faithfulnessScore = 1, hallucinationRate = 0', () => {
      const claims = [
        { verdict: 'SUPPORTED' as const, supported: true },
        { verdict: 'SUPPORTED' as const, supported: true },
      ];
      expect(faithfulnessScore(claims)).toBe(1);
      expect(claimLevelHallucinationRate(claims)).toBe(0);
    });

    it('có claim contradicted -> faithfulnessScore bị trừ điểm nặng', () => {
      const claims = [
        { verdict: 'SUPPORTED' as const, supported: true },
        { verdict: 'CONTRADICTED' as const, supported: false },
      ];
      // (1 - 2*1)/2 = -0.5 -> kẹp về 0
      expect(faithfulnessScore(claims)).toBe(0);
      expect(claimLevelHallucinationRate(claims)).toBe(0.5);
    });

    it('claims rỗng -> null', () => {
      expect(faithfulnessScore([])).toBeNull();
      expect(claimLevelHallucinationRate([])).toBeNull();
    });
  });

  describe('meanIgnoringNull / meanBool', () => {
    it('meanIgnoringNull bỏ qua null, toàn null -> null', () => {
      expect(meanIgnoringNull([1, null, 0])).toBe(0.5);
      expect(meanIgnoringNull([null, null])).toBeNull();
    });
    it('meanBool = tỉ lệ true', () => {
      expect(meanBool([true, false, true, false])).toBe(0.5);
      expect(meanBool([])).toBe(0);
    });
  });
});
