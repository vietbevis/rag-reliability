/**
 * Thống kê cho báo cáo đánh giá (docs/audit/EVALUATION_REVIEW.md §2, §4.3).
 *
 * Với golden dataset nhỏ, một điểm số trung bình trần trụi che giấu sai số mẫu.
 * `bootstrapCI` ước lượng khoảng tin cậy bằng bootstrap lấy mẫu có hoàn lại —
 * tất định (RNG có seed) để CI không đổi giữa các lần chạy cùng dữ liệu.
 */

/** RNG tất định (mulberry32) — cùng seed → cùng dãy số. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapCI {
  mean: number;
  /** Cận dưới của khoảng tin cậy (percentile). */
  low: number;
  /** Cận trên. */
  high: number;
  /** Nửa độ rộng khoảng: (high - low) / 2 — tiện in "x ± e". */
  marginOfError: number;
  n: number;
}

export interface BootstrapOptions {
  iterations?: number;
  /** Mức tin cậy, mặc định 0.95. */
  confidence?: number;
  seed?: number;
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Khoảng tin cậy bootstrap (percentile method) cho TRUNG BÌNH của `values`.
 * `values` là số thực bất kỳ; với tỉ lệ pass/abstain, truyền 0/1.
 * Mảng rỗng → null. Mảng 1 phần tử → CI suy biến bằng chính giá trị đó.
 */
export function bootstrapCI(
  values: readonly number[],
  opts: BootstrapOptions = {},
): BootstrapCI | null {
  const n = values.length;
  if (n === 0) return null;

  const iterations = opts.iterations ?? 2000;
  const confidence = opts.confidence ?? 0.95;
  const rand = mulberry32(opts.seed ?? 0x9e3779b9);

  const observedMean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return {
      mean: round(observedMean),
      low: round(observedMean),
      high: round(observedMean),
      marginOfError: 0,
      n,
    };
  }

  const means = new Array<number>(iterations);
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(rand() * n)]!;
    }
    means[it] = sum / n;
  }
  means.sort((a, b) => a - b);

  const alpha = (1 - confidence) / 2;
  const lowIdx = Math.floor(alpha * iterations);
  const highIdx = Math.min(
    iterations - 1,
    Math.ceil((1 - alpha) * iterations) - 1,
  );
  const low = means[lowIdx]!;
  const high = means[highIdx]!;

  return {
    mean: round(observedMean),
    low: round(low),
    high: round(high),
    marginOfError: round((high - low) / 2),
    n,
  };
}
