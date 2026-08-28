// Nạp .env cho test e2e/integration (cần DATABASE_URL, provider keys...).
import 'dotenv/config';
import { jest } from '@jest/globals';

// e2e không có API key thật -> dùng embedding provider `fake` (tất định) để
// chạy được toàn bộ pipeline tới COMPLETED.
process.env.EMBEDDING_PROVIDER = 'fake';

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
