// Nạp .env cho test e2e/integration (cần DATABASE_URL, provider keys...).
import 'dotenv/config';
import { jest } from '@jest/globals';

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
