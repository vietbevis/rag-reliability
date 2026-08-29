import { mockConfigService } from '../../config/config.mock';
import type { PrismaService } from '../../database/prisma.service';
import type { RetrievedChunk } from '../../common/types';
import { TableExpansionService } from './table-expansion.service';

function chunk(
  id: string,
  score: number,
  metadata: Record<string, unknown> = {},
): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'd0',
    content: `nội dung ${id}`,
    score,
    source: 'vector',
    metadata,
  };
}

function build(
  rows: unknown[],
  cfg: Partial<{
    tableExpansion: boolean;
    tableExpansionMaxChunks: number;
  }> = {},
) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const config = mockConfigService({ rag: cfg });
  return { svc: new TableExpansionService(prisma, config), queryRaw };
}

const siblingRow = (id: string, seq: number) => ({
  id,
  documentId: 'd0',
  content: `| Ngành ${id} | ${seq} |`,
  heading: 'Bảng',
  section: 'Điểm chuẩn > Bảng',
  page: null,
  metadata: { tableGroup: 'tg1', sequence: seq },
});

describe('TableExpansionService', () => {
  it('kéo các mảnh còn lại của bảng bị cắt, xếp ngay dưới mảnh kích hoạt', async () => {
    const { svc, queryRaw } = build([
      siblingRow('t1', 0),
      siblingRow('t2', 1),
      siblingRow('t3', 2),
    ]);
    const input = [
      chunk('t2', 0.8, { tableGroup: 'tg1' }), // mảnh khớp
      chunk('x', 0.5),
    ];
    const res = await svc.expand(input);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const ids = res.chunks.map((c) => c.chunkId).sort();
    expect(ids).toEqual(['t1', 't2', 't3', 'x']);
    const added = res.chunks.filter((c) => c.metadata.tableExpanded);
    expect(added.map((c) => c.chunkId).sort()).toEqual(['t1', 't3']);
    for (const c of added) {
      expect(c.score).toBeLessThan(0.8);
      expect(c.score).toBeGreaterThan(0.79);
      expect(c.source).toBe('vector');
    }
    expect(res.trace).toEqual({
      enabled: true,
      groups: 1,
      added: 2,
      capped: false,
    });
  });

  it('không trùng chunk đã có trong kết quả', async () => {
    const { svc } = build([siblingRow('t1', 0), siblingRow('t2', 1)]);
    const res = await svc.expand([chunk('t1', 0.9, { tableGroup: 'tg1' })]);
    expect(res.chunks.filter((c) => c.chunkId === 't1')).toHaveLength(1);
    expect(res.chunks.map((c) => c.chunkId).sort()).toEqual(['t1', 't2']);
  });

  it('tôn trọng trần RAG_TABLE_EXPANSION_MAX_CHUNKS', async () => {
    const { svc } = build(
      [siblingRow('t1', 0), siblingRow('t2', 1), siblingRow('t3', 2)],
      { tableExpansionMaxChunks: 1 },
    );
    const res = await svc.expand([chunk('t2', 0.8, { tableGroup: 'tg1' })]);
    expect(res.chunks.filter((c) => c.metadata.tableExpanded)).toHaveLength(1);
    expect(res.trace.capped).toBe(true);
  });

  it('không làm gì khi không có chunk nào thuộc bảng bị cắt', async () => {
    const { svc, queryRaw } = build([]);
    const input = [chunk('a', 0.9, { hasTable: true }), chunk('b', 0.5)];
    const res = await svc.expand(input);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(res.chunks).toBe(input);
    expect(res.trace).toEqual({ enabled: true, groups: 0, added: 0 });
  });

  it('tắt qua cờ → pass-through', async () => {
    const { svc, queryRaw } = build([siblingRow('t1', 0)], {
      tableExpansion: false,
    });
    const input = [chunk('t2', 0.8, { tableGroup: 'tg1' })];
    const res = await svc.expand(input);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(res.chunks).toBe(input);
    expect(res.trace).toEqual({ enabled: false });
  });

  it('lỗi DB khi bổ sung → không ném, trả nguyên kết quả gốc', async () => {
    const queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const svc = new TableExpansionService(prisma, mockConfigService({}));
    const input = [chunk('t2', 0.8, { tableGroup: 'tg1' })];
    const res = await svc.expand(input);
    expect(res.chunks).toBe(input);
    expect(res.trace).toEqual({ enabled: true, groups: 1, added: 0 });
  });
});
