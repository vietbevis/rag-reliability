import { mockConfigService } from '../../config/config.mock';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { StructureAwareChunkerService } from './structure-aware-chunker.service';

function make(
  overrides: Partial<{
    maxTokens: number;
    minTokens: number;
    overlapTokens: number;
  }> = {},
) {
  const config = mockConfigService({
    chunking: { maxTokens: 60, minTokens: 8, overlapTokens: 10, ...overrides },
  });
  return new StructureAwareChunkerService(config, new TokenCounterService());
}

const bigSection = (heading: string, sentences: number) =>
  `## ${heading}\n\n` +
  Array.from(
    { length: sentences },
    (_, i) =>
      `Câu ${i} nói về nội dung quan trọng của phần này trong quy chế đào tạo.`,
  ).join(' ');

describe('StructureAwareChunkerService', () => {
  it('mỗi chunk mang heading + breadcrumb section', async () => {
    const md =
      '# Quy chế\n\n## Chương I\n\n### Điều 1\n\nSinh viên được bảo lưu tối đa hai học kỳ liên tiếp trong toàn khoá học theo quy định.';
    const chunks = await make().split({ markdown: md, text: '' });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.section).toBe('Quy chế > Chương I > Điều 1');
    expect(chunks[0]!.heading).toBe('Điều 1');
  });

  it('không vượt CHUNK_MAX_TOKENS (trừ block đơn quá lớn)', async () => {
    const md = `# D\n\n${bigSection('A', 20)}\n\n${bigSection('B', 20)}`;
    const chunks = await make({ maxTokens: 50 }).split({
      markdown: md,
      text: '',
    });
    const tokens = new TokenCounterService();
    for (const c of chunks) {
      expect(tokens.count(c.content)).toBeLessThanOrEqual(50 * 1.2);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('gộp section nhỏ vào chunk trước cùng nhánh heading', async () => {
    const md = [
      '# Quy chế',
      '## Chương I',
      '### Điều 1',
      'Ngắn.',
      '### Điều 2',
      'Cũng ngắn.',
    ].join('\n\n');
    const chunks = await make({ minTokens: 20, maxTokens: 200 }).split({
      markdown: md,
      text: '',
    });
    const merged = chunks.find(
      (c) => (c.metadata.mergedSections as string[] | undefined)?.length,
    );
    expect(merged).toBeDefined();
  });

  it('block quá lớn -> tách nhiều piece với splitReason tương ứng', async () => {
    const huge =
      '# T\n\n' +
      Array.from({ length: 30 }, (_, i) => `Đây là câu số ${i} rất dài.`).join(
        ' ',
      );
    const chunks = await make({ maxTokens: 30 }).split({
      markdown: huge,
      text: '',
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.some((c) => c.metadata.splitReason === 'block-oversized-split'),
    ).toBe(true);
  });

  it('bảng GFM quá lớn -> mỗi mảnh lặp lại header + separator', async () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `| Ngành ${i} | A0${i % 5} | ${20 + i},5 | ${50 + i} |`,
    );
    const md = [
      '# Điểm chuẩn',
      '## Bảng',
      '| Ngành | Tổ hợp | Điểm | Chỉ tiêu |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
    const chunks = await make({ maxTokens: 120, overlapTokens: 10 }).split({
      markdown: md,
      text: '',
    });
    const tableChunks = chunks.filter((c) => c.content.includes('| ---'));
    expect(tableChunks.length).toBeGreaterThan(1);
    for (const c of tableChunks) {
      expect(c.content).toContain('| Ngành | Tổ hợp | Điểm | Chỉ tiêu |');
      expect(
        c.content.indexOf('| --- | --- | --- | --- |'),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('fallback sang text thô khi không có markdown', async () => {
    const chunks = await make().split({
      text: 'Một đoạn văn thô không có bất kỳ heading markdown nào ở đây cả.',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.section).toBeUndefined();
  });
});
