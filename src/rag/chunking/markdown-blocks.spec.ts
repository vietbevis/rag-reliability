import { containsGfmTable, parseMarkdownSections } from './markdown-blocks';

describe('parseMarkdownSections', () => {
  it('tách section theo heading và dựng breadcrumb', () => {
    const md = [
      '# Quy chế',
      '',
      'Mở đầu.',
      '',
      '## Chương I',
      '',
      '### Điều 1',
      '',
      'Nội dung điều 1.',
      '',
      '### Điều 2',
      '',
      'Nội dung điều 2.',
    ].join('\n');

    const sections = parseMarkdownSections(md);
    const paths = sections.map((s) => s.headingPath.join(' > '));
    expect(paths).toEqual([
      'Quy chế',
      'Quy chế > Chương I > Điều 1',
      'Quy chế > Chương I > Điều 2',
    ]);
  });

  it('giữ nguyên code fence như một block', () => {
    const md = '# T\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nsau code.';
    const [section] = parseMarkdownSections(md);
    const code = section!.blocks.find((b) => b.type === 'code');
    expect(code?.text).toContain('const a = 1;');
    expect(code?.text).toContain('const b = 2;');
  });

  it('nhận diện bảng và danh sách', () => {
    const md = [
      '# T',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- mục một',
      '- mục hai',
    ].join('\n');
    const [section] = parseMarkdownSections(md);
    const types = section!.blocks.map((b) => b.type);
    expect(types).toEqual(expect.arrayContaining(['table', 'list']));
  });

  it('text trước heading đầu tiên là section level 0', () => {
    const [section] = parseMarkdownSections('Đoạn mở đầu không có heading.');
    expect(section!.level).toBe(0);
    expect(section!.headingPath).toEqual([]);
  });
});

describe('containsGfmTable', () => {
  it('nhận diện bảng GFM (dấu phân cách nhiều kiểu)', () => {
    expect(containsGfmTable('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(true);
    expect(
      containsGfmTable(
        'Trước bảng.\n\n| Mức | Tỷ lệ |\n| --- | ---: |\n| A | 100% |',
      ),
    ).toBe(true);
    expect(containsGfmTable('| x | y |\n|:---:|:---:|\n| 1 | 2 |')).toBe(true);
  });

  it('KHÔNG nhận nhầm văn bản thường / danh sách có dấu gạch', () => {
    expect(containsGfmTable('Đoạn văn bình thường, có dấu - gạch ngang.')).toBe(
      false,
    );
    expect(containsGfmTable('- mục một\n- mục hai\n- mục ba')).toBe(false);
    expect(containsGfmTable('| chỉ một dòng có pipe |')).toBe(false);
  });
});
