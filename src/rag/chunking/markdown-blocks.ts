/**
 * Phân tích Markdown (từ anydoc) thành cây section theo heading, mỗi section
 * chứa các "block" nguyên vẹn (đoạn văn, code fence, bảng, danh sách). Đây là
 * bước nền cho structure-aware chunking (PROMPT §12).
 */

export type BlockType = 'paragraph' | 'code' | 'table' | 'list' | 'quote';

export interface MdBlock {
  type: BlockType;
  text: string;
}

export interface MdSection {
  /** Breadcrumb heading, gốc -> hiện tại. Rỗng = phần mở đầu trước heading. */
  headingPath: string[];
  /** Cấp heading của section này (1-6); 0 = phần mở đầu. */
  level: number;
  blocks: MdBlock[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(```|~~~)/;

export function parseMarkdownSections(markdown: string): MdSection[] {
  const lines = markdown.split('\n');
  const sections: MdSection[] = [];
  const headingStack: string[] = [];

  let current: MdSection = { headingPath: [], level: 0, blocks: [] };
  const pushSection = (): void => {
    if (current.blocks.length > 0) sections.push(current);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // heading -> mở section mới
    const heading = HEADING_RE.exec(line);
    if (heading) {
      pushSection();
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      headingStack.length = level - 1;
      headingStack[level - 1] = title;
      current = {
        headingPath: headingStack.slice(0, level).filter(Boolean),
        level,
        blocks: [],
      };
      i++;
      continue;
    }

    // dòng trống -> bỏ qua
    if (line.trim() === '') {
      i++;
      continue;
    }

    // code fence -> gom tới fence đóng
    if (FENCE_RE.test(line)) {
      const fence = line.trim().slice(0, 3);
      const buf = [line];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence)) {
        buf.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) {
        buf.push(lines[i] ?? '');
        i++;
      }
      current.blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    // bảng / danh sách / trích dẫn / đoạn văn -> gom các dòng liền nhau
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const l = lines[i] ?? '';
      if (HEADING_RE.test(l) || FENCE_RE.test(l)) break;
      buf.push(l);
      i++;
    }
    const text = buf.join('\n');
    current.blocks.push({ type: classifyBlock(buf), text });
  }

  pushSection();
  return sections;
}

function classifyBlock(lines: string[]): BlockType {
  const first = lines[0]?.trimStart() ?? '';
  if (lines.filter((l) => l.trimStart().startsWith('|')).length >= 2) {
    return 'table';
  }
  if (/^([-*+]\s|\d+[.)]\s)/.test(first)) return 'list';
  if (first.startsWith('>')) return 'quote';
  return 'paragraph';
}

/**
 * Có phải văn bản chứa một bảng GFM (dòng ô `| ... |` + dòng phân cách
 * `| --- | --- |`)? Dùng để đánh dấu chunk có bảng cho retrieval bảng (P4) —
 * câu hỏi kiểu "liệt kê các mức / tỷ lệ" cần đủ mọi dòng bảng, không chỉ vài dòng.
 */
export function containsGfmTable(text: string): boolean {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]?.trim() ?? '';
    if (header.startsWith('|') && isTableSeparatorRow(lines[i + 1] ?? '')) {
      return true;
    }
  }
  return false;
}

/** Dòng phân cách bảng GFM: `| --- | :--: |` — mỗi ô chỉ gồm `-` và tuỳ chọn `:`. */
function isTableSeparatorRow(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return cells.length >= 1 && cells.every((c) => /^:?-+:?$/.test(c));
}
