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
// e2e bắn nhiều request liên tiếp vào /rag/* — tắt rate limiting để không dính 429.
process.env.RATE_LIMIT_ENABLED = 'false';
// e2e không có Redis → queue chạy inline đồng bộ (ghi đè cứng giá trị `.env`).
// Chỉ bật khi chạy bộ e2e async THẬT: `AGENT_ASYNC_E2E=1` (cần Redis).
process.env.QUEUE_ENABLED =
  process.env.AGENT_ASYNC_E2E === '1' ? 'true' : 'false';
// E5 1024d không chạy được với provider fake ở e2e → giữ 1536 cho fixture cũ,
// nhưng provider fake sinh vector theo EMBEDDING_DIMENSION nên chỉ cần nhất quán.
process.env.EMBEDDING_DIMENSION = process.env.EMBEDDING_DIMENSION ?? '1024';

// Golden dataset dùng fixture nhỏ, tất định (không đụng `evaluation/datasets/` thật).
// jest chạy từ gốc repo (rootDir = ./test nhưng cwd = gốc).
process.env.EVAL_DATASETS_DIR = resolve(
  process.cwd(),
  'test/fixtures/eval-datasets',
);

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
