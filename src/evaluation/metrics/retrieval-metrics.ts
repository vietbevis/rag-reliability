/**
 * Số liệu chất lượng truy hồi (PROMPT §33). Toàn bộ là hàm thuần, không phụ
 * thuộc Nest — dễ test và tái dùng trong benchmark.
 *
 * Quy ước tham số:
 * - `retrieved`: danh sách id **đã xếp hạng** (vị trí 0 = liên quan nhất).
 *   Có thể trùng id (fusion nhiều nguồn); các hàm tự khử trùng khi cần.
 * - `relevant`: tập id được coi là đúng (gold).
 *
 * Id ở đây trừu tượng: caller truyền id chunk hoặc `source` tài liệu tuỳ mức
 * đánh giá.
 */

function dedupeInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function topK(ids: readonly string[], k: number): string[] {
  return dedupeInOrder(ids).slice(0, Math.max(0, k));
}

/** Tỉ lệ id gold xuất hiện trong top-k. `relevant` rỗng → trả 1 (không có gì để bỏ sót). */
export function recallAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  const hits = topK(retrieved, k).filter((id) => gold.has(id)).length;
  return round(hits / gold.size);
}

/** Tỉ lệ item trong top-k là gold. Mẫu số = min(k, số item thực có). */
export function precisionAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  const gold = new Set(relevant);
  const top = topK(retrieved, k);
  if (top.length === 0) return 0;
  const hits = top.filter((id) => gold.has(id)).length;
  return round(hits / top.length);
}

/** Mean Reciprocal Rank — 1/(hạng của gold đầu tiên), 0 nếu không có. */
export function mrr(
  retrieved: readonly string[],
  relevant: readonly string[],
): number {
  const gold = new Set(relevant);
  const list = dedupeInOrder(retrieved);
  for (let i = 0; i < list.length; i++) {
    if (gold.has(list[i]!)) return round(1 / (i + 1));
  }
  return 0;
}

/** NDCG@k với gain nhị phân (gold = 1). */
export function ndcgAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  const top = topK(retrieved, k);

  let dcg = 0;
  top.forEach((id, i) => {
    if (gold.has(id)) dcg += 1 / Math.log2(i + 2);
  });

  const ideal = Math.min(gold.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);

  return idcg === 0 ? 0 : round(dcg / idcg);
}

/**
 * Context Precision (kiểu Ragas, không cần câu trả lời): trung bình có trọng số
 * của precision@i tại mỗi vị trí i có item gold, chia cho tổng số gold trong
 * top-k. Đo mức "các item liên quan có được xếp lên đầu không".
 */
export function contextPrecision(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  const gold = new Set(relevant);
  const top = topK(retrieved, k);
  let hits = 0;
  let weighted = 0;
  top.forEach((id, i) => {
    if (gold.has(id)) {
      hits++;
      weighted += hits / (i + 1);
    }
  });
  return hits === 0 ? 0 : round(weighted / hits);
}

/**
 * Context Recall (mức truy hồi): tỉ lệ id gold có mặt ở **bất kỳ đâu** trong
 * danh sách retrieved (không giới hạn top-k). PHASE 9-10 sẽ thay bằng bản
 * claim-based cần câu trả lời.
 */
export function contextRecall(
  retrieved: readonly string[],
  relevant: readonly string[],
): number {
  const gold = new Set(relevant);
  if (gold.size === 0) return 1;
  const all = new Set(retrieved);
  const hits = [...gold].filter((id) => all.has(id)).length;
  return round(hits / gold.size);
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
