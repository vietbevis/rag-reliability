import type { RetrievalSource, RetrievedChunk } from '../../common/types';

/**
 * Hợp nhất kết quả từ nhiều retriever (PROMPT §18, graph-rag.md §4). Hàm thuần.
 *
 * - **RRF** (Reciprocal Rank Fusion): `Σ_r w_r / (k + rank_r)` — bền vững, KHÔNG
 *   cần score các nguồn cùng thang đo (khuyến nghị mặc định).
 * - **weighted**: `Σ_r w_r · score_r` — dùng khi score đã chuẩn hoá [0,1] và
 *   muốn giữ độ lớn tương đối.
 *
 * Chunk trùng (theo `chunkId`) giữa các nguồn được cộng điểm. `source` của chunk
 * hợp nhất = `'hybrid'` nếu đến từ >1 nguồn, ngược lại giữ nguyên nguồn gốc.
 * `metadata.fusion` ghi lại rank/score từng nguồn để trace.
 */

export interface RetrieverOutput {
  source: RetrievalSource;
  chunks: RetrievedChunk[];
}

export interface FusionConfig {
  method: 'rrf' | 'weighted';
  rrfK: number;
  weights: Partial<Record<RetrievalSource, number>>;
}

interface Accum {
  chunk: RetrievedChunk;
  score: number;
  sources: Set<RetrievalSource>;
  perSource: Record<string, { rank: number; score: number }>;
}

export function fuse(
  outputs: RetrieverOutput[],
  config: FusionConfig,
  topK: number,
): RetrievedChunk[] {
  const nonEmpty = outputs.filter((o) => o.chunks.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) {
    // Một nguồn → chỉ cắt topK, không đổi score/source.
    return [...nonEmpty[0]!.chunks]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  const acc = new Map<string, Accum>();

  // Trần điểm LÝ THUYẾT (một chunk đứng #1 ở MỌI nguồn) — chuẩn hoá theo cái này
  // để "mọi kết quả đều yếu" KHÔNG bị thổi lên 1.0 (giữ tín hiệu cho
  // ContextValidator). KHÁC với chia cho max của batch hiện tại.
  let theoreticalMax = 0;
  for (const out of nonEmpty) {
    const w = config.weights[out.source] ?? 1;
    theoreticalMax += config.method === 'rrf' ? w / (config.rrfK + 1) : w;
  }

  for (const out of nonEmpty) {
    const w = config.weights[out.source] ?? 1;
    // Xếp hạng nội bộ nguồn theo score giảm dần (rank bắt đầu từ 1).
    const ranked = [...out.chunks].sort((a, b) => b.score - a.score);
    ranked.forEach((chunk, i) => {
      const rank = i + 1;
      const contrib =
        config.method === 'rrf'
          ? w / (config.rrfK + rank)
          : w * clamp01(chunk.score);

      let entry = acc.get(chunk.chunkId);
      if (!entry) {
        entry = {
          chunk,
          score: 0,
          sources: new Set(),
          perSource: {},
        };
        acc.set(chunk.chunkId, entry);
      }
      entry.score += contrib;
      entry.sources.add(out.source);
      entry.perSource[out.source] = { rank, score: round(chunk.score) };
      // Giữ bản chunk có nội dung/metadata "giàu" nhất (ưu tiên bản đầu tiên).
    });
  }

  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => {
      const source: RetrievalSource =
        e.sources.size > 1 ? 'hybrid' : ([...e.sources][0] ?? e.chunk.source);
      return {
        ...e.chunk,
        score: clamp01(
          round(theoreticalMax > 0 ? e.score / theoreticalMax : 0),
        ),
        source,
        metadata: {
          ...e.chunk.metadata,
          fusion: {
            method: config.method,
            fromSources: [...e.sources],
            perSource: e.perSource,
            rawScore: round(e.score),
          },
        },
      };
    });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
