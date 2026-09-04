import {
  checkNumericProvenance,
  chunksBackingNumbers,
  extractNumbers,
  isGenericYear,
} from './numeric-provenance';

describe('extractNumbers', () => {
  it('bỏ dấu phân cách nghìn, chuẩn hoá', () => {
    const s = extractNumbers('Tổng doanh thu là 684.500 đồng.');
    expect(s.has('684500')).toBe(true);
  });

  it('nhiều số + dấu phẩy', () => {
    const s = extractNumbers('37 thùng, mỗi thùng 1,161 sản phẩm.');
    expect(s.has('37')).toBe(true);
    expect(s.has('1161')).toBe(true);
  });

  it('bỏ số 1 chữ số', () => {
    const s = extractNumbers('có 3 con và 2 mèo, tổng 5');
    expect(s.has('3')).toBe(false);
    expect(s.has('5')).toBe(false);
  });

  it('không có số → tập rỗng', () => {
    expect(extractNumbers('không có gì').size).toBe(0);
  });
});

describe('checkNumericProvenance', () => {
  it('mọi số trong answer có trong evidence → allGrounded', () => {
    const r = checkNumericProvenance('Kết quả là 684.500 đồng (37 x 18500).', [
      '37*18500 = 684500',
    ]);
    expect(r.checked).toBeGreaterThan(0);
    expect(r.allGrounded).toBe(true);
    expect(r.ungrounded).toHaveLength(0);
  });

  it('có số không truy được → không allGrounded', () => {
    const r = checkNumericProvenance('Tổng là 999999 đồng.', [
      '37*18500 = 684500',
    ]);
    expect(r.allGrounded).toBe(false);
    expect(r.ungrounded).toContain('999999');
  });

  it('answer không có số → checked 0, allGrounded false', () => {
    const r = checkNumericProvenance('không rõ', ['684500']);
    expect(r.checked).toBe(0);
    expect(r.allGrounded).toBe(false);
  });
});

describe('isGenericYear', () => {
  it('nhận diện năm dương lịch trơ trọi (1900-2099, 4 chữ số)', () => {
    expect(isGenericYear('2026')).toBe(true);
    expect(isGenericYear('1999')).toBe(true);
  });

  it('không nhận nhầm số 4 chữ số khác (cổng, mã, tiền)', () => {
    expect(isGenericYear('6379')).toBe(false); // cổng Redis
    expect(isGenericYear('1024')).toBe(false); // số chiều embedding
  });

  it('không nhận nhầm số khác 4 chữ số', () => {
    expect(isGenericYear('20260904')).toBe(false);
    expect(isGenericYear('99')).toBe(false);
  });
});

describe('chunksBackingNumbers', () => {
  it('trả chunkId chứa số của claim', () => {
    const ids = chunksBackingNumbers('Tổng 684.500 đồng', [
      { chunkId: 'c1', content: 'linh tinh' },
      { chunkId: 'c2', content: 'phép tính: 684500' },
    ]);
    expect(ids).toEqual(['c2']);
  });
});
