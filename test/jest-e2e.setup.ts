// Nạp .env cho test e2e/integration (cần DATABASE_URL, provider keys...).
import 'dotenv/config';
import { resolve } from 'node:path';
import { jest } from '@jest/globals';

// e2e không có API key thật -> dùng provider `fake` (tất định) cho cả embedding
// lẫn LLM để chạy được toàn bộ pipeline (ingest → embed → RAG query) + eval.
process.env.EMBEDDING_PROVIDER = 'fake';
process.env.LLM_PROVIDER = 'fake';
// Reranker: mặc định TẮT (RERANK_ENABLED không đặt); provider `fake` (tất định)
// để test nào bật `rerank: true` / benchmark-rerank chạy được không cần LLM.
process.env.RERANK_PROVIDER = 'fake';

// Golden dataset dùng fixture nhỏ, tất định (không đụng `evaluation/datasets/` thật).
// jest chạy từ gốc repo (rootDir = ./test nhưng cwd = gốc).
process.env.EVAL_DATASETS_DIR = resolve(
  process.cwd(),
  'test/fixtures/eval-datasets',
);

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
