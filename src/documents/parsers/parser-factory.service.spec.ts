import { ParserFactoryService } from './parser-factory.service';
import { AnydocParserService } from './anydoc-parser.service';
import { HtmlParserService } from './html-parser.service';
import { PlainTextParserService } from './plain-text-parser.service';
import { ParserError } from '../../common/errors';

function makeFactory(anydocAvailable: boolean) {
  const anydoc = {
    type: 'anydoc' as const,
    supports: (m: string) =>
      m === 'application/pdf' ||
      m ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    isAvailable: jest.fn().mockResolvedValue(anydocAvailable),
    parse: jest.fn(),
  } as unknown as AnydocParserService;
  return new ParserFactoryService(
    anydoc,
    new PlainTextParserService(),
    new HtmlParserService(),
  );
}

describe('ParserFactoryService.resolve', () => {
  it('chọn anydoc cho định dạng nhị phân khi lib khả dụng', async () => {
    const parser = await makeFactory(true).resolve('application/pdf');
    expect(parser.type).toBe('anydoc');
  });

  it('chọn plaintext cho markdown', async () => {
    const parser = await makeFactory(true).resolve('text/markdown');
    expect(parser.type).toBe('plaintext');
  });

  it('chọn html cho text/html', async () => {
    const parser = await makeFactory(true).resolve('text/html');
    expect(parser.type).toBe('html');
  });

  it('hạ xuống fallback text khi anydoc không khả dụng nhưng có fallback khớp', async () => {
    // docx không có fallback text -> phải báo PARSER_UNAVAILABLE
    await expect(
      makeFactory(false).resolve(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toMatchObject({ code: 'PARSER_UNAVAILABLE' });
  });

  it('ném UNSUPPORTED_MIME cho type không xử lý được', async () => {
    await expect(
      makeFactory(true).resolve('application/x-tar'),
    ).rejects.toBeInstanceOf(ParserError);
  });
});
