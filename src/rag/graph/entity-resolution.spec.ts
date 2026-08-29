import { resolveGraph, type ChunkExtractionInput } from './entity-resolution';

const ent = (name: string, type = 'CONCEPT', description = '') => ({
  name,
  type,
  description,
});
const rel = (
  source: string,
  target: string,
  type = 'RELATED_TO',
  description = '',
  strength = 5,
) => ({ source, target, type, description, strength });

describe('resolveGraph', () => {
  it('gộp entity trùng tên+loại qua nhiều chunk, cộng dồn chunkId', () => {
    const chunks: ChunkExtractionInput[] = [
      {
        chunkId: 'c1',
        entities: [ent('Bách Khoa', 'ORG', 'trường')],
        relationships: [],
      },
      {
        chunkId: 'c2',
        entities: [ent('bách khoa', 'org', 'đại học')],
        relationships: [],
      },
      {
        chunkId: 'c3',
        entities: [ent('Phòng Đào Tạo', 'ORG')],
        relationships: [],
      },
    ];
    const g = resolveGraph('d1', chunks);
    expect(g.entities).toHaveLength(2);
    const bk = g.entities.find((e) => e.name.toLowerCase() === 'bách khoa')!;
    expect(bk.chunkIds.sort()).toEqual(['c1', 'c2']);
    expect(bk.description).toContain('trường');
    expect(bk.description).toContain('đại học');
  });

  it('quan hệ không phân biệt chiều → cùng key, chunkId cộng dồn', () => {
    const chunks: ChunkExtractionInput[] = [
      {
        chunkId: 'c1',
        entities: [ent('A'), ent('B')],
        relationships: [rel('A', 'B', 'HOP_TAC')],
      },
      {
        chunkId: 'c2',
        entities: [ent('A'), ent('B')],
        relationships: [rel('B', 'A', 'HOP_TAC')],
      },
    ];
    const g = resolveGraph('d1', chunks);
    expect(g.relationships).toHaveLength(1);
    expect(g.relationships[0]!.chunkIds.sort()).toEqual(['c1', 'c2']);
  });

  it('bỏ quan hệ có đầu mút không nằm trong danh sách entity', () => {
    const chunks: ChunkExtractionInput[] = [
      {
        chunkId: 'c1',
        entities: [ent('A')],
        relationships: [rel('A', 'Không Tồn Tại')],
      },
    ];
    const g = resolveGraph('d1', chunks);
    expect(g.relationships).toHaveLength(0);
  });

  it('bỏ quan hệ tự trỏ (A-A)', () => {
    const chunks: ChunkExtractionInput[] = [
      { chunkId: 'c1', entities: [ent('A')], relationships: [rel('A', 'a')] },
    ];
    expect(resolveGraph('d1', chunks).relationships).toHaveLength(0);
  });

  it('key entity tất định theo name+type (không phụ thuộc thứ tự chunk)', () => {
    const a = resolveGraph('d1', [
      { chunkId: 'c1', entities: [ent('X', 'PERSON')], relationships: [] },
    ]);
    const b = resolveGraph('d2', [
      { chunkId: 'z9', entities: [ent('x', 'person')], relationships: [] },
    ]);
    expect(a.entities[0]!.key).toBe(b.entities[0]!.key);
  });

  it('rỗng → đồ thị rỗng nhưng vẫn mang documentId + chunkIds', () => {
    const g = resolveGraph('d1', [
      { chunkId: 'c1', entities: [], relationships: [] },
    ]);
    expect(g).toMatchObject({ documentId: 'd1', chunkIds: ['c1'] });
    expect(g.entities).toEqual([]);
    expect(g.relationships).toEqual([]);
  });
});
