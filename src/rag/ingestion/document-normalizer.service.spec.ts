import { DocumentNormalizerService } from './document-normalizer.service';

const BOM = String.fromCharCode(0xfeff);
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0x00a0);

describe('DocumentNormalizerService', () => {
  const svc = new DocumentNormalizerService();

  it('chuẩn hoá CRLF về LF', () => {
    const r = svc.normalize('a\r\nb\rc');
    expect(r.text).toBe('a\nb\nc');
    expect(r.transformations).toContain('newlines:LF');
  });

  it('bỏ ký tự zero-width và BOM', () => {
    const r = svc.normalize(`${BOM}xin${ZWSP}chào`);
    expect(r.text).toBe('xinchào');
    expect(r.transformations).toEqual(
      expect.arrayContaining(['strip:BOM', 'strip:zero-width']),
    );
  });

  it('chuẩn hoá Unicode NFC cho tiếng Việt (tổ hợp -> dựng sẵn)', () => {
    const decomposed = 'tiếng Việt'.normalize('NFD');
    expect(decomposed).not.toBe('tiếng Việt'); // đầu vào là dạng tổ hợp
    const r = svc.normalize(decomposed);
    expect(r.text).toBe('tiếng Việt');
    expect(r.transformations).toContain('unicode:NFC');
  });

  it('non-breaking space -> space thường', () => {
    const r = svc.normalize(`a${NBSP}b`);
    expect(r.text).toBe('a b');
    expect(r.transformations).toContain('whitespace:unicode-spaces');
  });

  it('gộp >2 dòng trống và trim', () => {
    const r = svc.normalize('  x\n\n\n\n\ny  ');
    expect(r.text).toBe('x\n\ny');
  });

  it('không thêm transformation nếu text đã sạch', () => {
    const r = svc.normalize('văn bản sạch');
    expect(r.transformations).toEqual([]);
  });
});
