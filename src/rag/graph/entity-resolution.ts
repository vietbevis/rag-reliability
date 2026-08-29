import { sha256 } from '../../common/utils';
import type {
  ExtractedEntity,
  ExtractedRelationship,
  ResolvedEntity,
  ResolvedGraph,
  ResolvedRelationship,
} from './graph.types';

/**
 * Gộp kết quả extraction của nhiều chunk thành đồ thị đã resolve cho MỘT tài
 * liệu (graph-rag.md §3, `entity-resolution`). Hàm thuần — dễ test.
 *
 * - `Entity.key = sha256(lower(name) | lower(type))` — thực thể trùng tên+loại
 *   ở nhiều chunk gộp làm một, chunkId cộng dồn.
 * - `Relationship.key = sha256(sort(srcKey,tgtKey) | lower(type))` — quan hệ
 *   không phân biệt chiều khi resolve (traversal P6 dùng `-[:RELATED]-`).
 * - description = nối các mô tả duy nhất, cắt theo độ dài.
 */
export interface ChunkExtractionInput {
  chunkId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

const MAX_DESCRIPTION = 800;

export function resolveGraph(
  documentId: string,
  chunks: ChunkExtractionInput[],
): ResolvedGraph {
  const entities = new Map<
    string,
    ResolvedEntity & { descParts: Set<string> }
  >();
  const nameToKey = new Map<string, string>(); // norm(name) -> key (để nối quan hệ)

  const entityKey = (name: string, type: string): string =>
    sha256(`${norm(name)}|${norm(type)}`);

  for (const ck of chunks) {
    for (const e of ck.entities) {
      const key = entityKey(e.name, e.type);
      let cur = entities.get(key);
      if (!cur) {
        cur = {
          key,
          name: e.name.trim(),
          type: e.type.trim().toUpperCase(),
          description: '',
          chunkIds: [],
          descParts: new Set<string>(),
        };
        entities.set(key, cur);
      }
      if (!cur.chunkIds.includes(ck.chunkId)) cur.chunkIds.push(ck.chunkId);
      if (e.description.trim()) cur.descParts.add(e.description.trim());
      // Ưu tiên tên xuất hiện nhiều nhất giữ nguyên; ở đây giữ tên đầu tiên.
      nameToKey.set(norm(e.name), key);
    }
  }

  const relationships = new Map<
    string,
    ResolvedRelationship & { descParts: Set<string> }
  >();

  for (const ck of chunks) {
    for (const r of ck.relationships) {
      const srcKey = nameToKey.get(norm(r.source));
      const tgtKey = nameToKey.get(norm(r.target));
      if (!srcKey || !tgtKey || srcKey === tgtKey) continue;

      const [a, b] = [srcKey, tgtKey].sort();
      const key = sha256(`${a}|${b}|${norm(r.type)}`);
      let cur = relationships.get(key);
      if (!cur) {
        cur = {
          key,
          sourceKey: a!,
          targetKey: b!,
          type: r.type.trim().toUpperCase().replace(/\s+/g, '_'),
          description: '',
          chunkIds: [],
          descParts: new Set<string>(),
        };
        relationships.set(key, cur);
      }
      if (!cur.chunkIds.includes(ck.chunkId)) cur.chunkIds.push(ck.chunkId);
      if (r.description.trim()) cur.descParts.add(r.description.trim());
    }
  }

  return {
    documentId,
    chunkIds: chunks.map((c) => c.chunkId),
    entities: [...entities.values()].map(({ descParts, ...e }) => ({
      ...e,
      description: joinDesc(descParts),
    })),
    relationships: [...relationships.values()].map(({ descParts, ...r }) => ({
      ...r,
      description: joinDesc(descParts),
    })),
  };
}

function joinDesc(parts: Set<string>): string {
  let out = '';
  for (const p of parts) {
    const next = out ? `${out}; ${p}` : p;
    if (next.length > MAX_DESCRIPTION) break;
    out = next;
  }
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
}
