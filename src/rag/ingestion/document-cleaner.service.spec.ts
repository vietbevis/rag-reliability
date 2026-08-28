import { DocumentCleanerService } from './document-cleaner.service';

describe('DocumentCleanerService', () => {
  const svc = new DocumentCleanerService();
  const count = (
    r: ReturnType<DocumentCleanerService['clean']>,
    name: string,
  ) => r.transformations.find((t) => t.name === name)?.count ?? 0;

  it('xoá dòng chỉ chứa số trang', () => {
    const r = svc.clean(
      'Nội dung đoạn một.\n\n12\n\nNội dung đoạn hai.\n\nTrang 3/10',
      { isMarkdown: false },
    );
    expect(r.text).not.toMatch(/^12$/m);
    expect(r.text).not.toContain('Trang 3/10');
    expect(count(r, 'remove:page-numbers')).toBeGreaterThanOrEqual(2);
  });

  it('xoá header/footer lặp lại nhiều lần (giữ lần đầu)', () => {
    const boiler = 'CÔNG TY ABC — BÁO CÁO MẬT';
    const text = [
      boiler,
      'Phần 1 nội dung.',
      boiler,
      'Phần 2 nội dung.',
      boiler,
      'Phần 3 nội dung.',
      boiler,
    ].join('\n\n');
    const r = svc.clean(text, { isMarkdown: true });
    expect(r.text.match(new RegExp(boiler, 'g'))?.length).toBe(1);
    expect(count(r, 'remove:repeated-headers-footers')).toBe(3);
  });

  it('nối từ bị ngắt bởi gạch nối cuối dòng', () => {
    const r = svc.clean('thông-\ntin quan trọng', { isMarkdown: false });
    expect(r.text).toContain('thôngtin');
  });

  it('bỏ đoạn văn trùng lặp liên tiếp', () => {
    const p = 'Đây là một đoạn văn bị lặp lại y hệt.';
    const r = svc.clean(`${p}\n\n${p}\n\nĐoạn khác.`, { isMarkdown: true });
    expect(
      r.text.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
        ?.length,
    ).toBe(1);
  });

  it('bỏ dòng nhiễu OCR (nhiều ký hiệu)', () => {
    const r = svc.clean(
      'Đoạn văn bình thường có nội dung.\n~|~ }{ @#% ^&*() |||\nĐoạn hai.',
      { isMarkdown: false },
    );
    expect(r.text).not.toContain('~|~');
    expect(count(r, 'remove:ocr-artifact-lines')).toBe(1);
  });

  it('không đụng tới separator Markdown ---', () => {
    const r = svc.clean('# Tiêu đề\n\n---\n\nNội dung.', { isMarkdown: true });
    expect(r.text).toContain('---');
  });

  it('bỏ escape Markdown thừa và HTML comment', () => {
    const r = svc.clean('văn bản \\* có \\_ escape\n<!-- ghi chú -->', {
      isMarkdown: true,
    });
    expect(r.text).toContain('văn bản * có _ escape');
    expect(r.text).not.toContain('<!--');
  });
});
