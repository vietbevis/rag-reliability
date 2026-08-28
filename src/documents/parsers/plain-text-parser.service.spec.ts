import { PlainTextParserService } from './plain-text-parser.service';
import { HtmlParserService } from './html-parser.service';
import { ParserError } from '../../common/errors';

const enc = (s: string) => new TextEncoder().encode(s);

describe('PlainTextParserService', () => {
  const parser = new PlainTextParserService();

  it('hỗ trợ text/plain và text/markdown', () => {
    expect(parser.supports('text/plain')).toBe(true);
    expect(parser.supports('text/markdown; charset=utf-8')).toBe(true);
    expect(parser.supports('application/pdf')).toBe(false);
  });

  it('giữ nguyên markdown và chuẩn hoá CRLF', async () => {
    const out = await parser.parse({
      bytes: enc('# Tiêu đề\r\n\r\nĐoạn văn.'),
      mimeType: 'text/markdown',
    });
    expect(out.markdown).toContain('# Tiêu đề');
    expect(out.text).not.toContain('\r');
    expect(out.parser).toBe('plaintext');
  });

  it('ném EMPTY_OUTPUT với file trống', async () => {
    await expect(
      parser.parse({ bytes: enc('   \n  '), mimeType: 'text/plain' }),
    ).rejects.toBeInstanceOf(ParserError);
  });
});

describe('HtmlParserService', () => {
  const parser = new HtmlParserService();

  it('loại bỏ thẻ, script và decode entity', async () => {
    const html =
      '<html><head><style>x{}</style></head><body><p>Xin&nbsp;chào &amp; tạm biệt</p><script>evil()</script></body></html>';
    const out = await parser.parse({ bytes: enc(html), mimeType: 'text/html' });
    expect(out.text).toContain('Xin chào & tạm biệt');
    expect(out.text).not.toContain('evil');
    expect(out.text).not.toContain('<');
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});
