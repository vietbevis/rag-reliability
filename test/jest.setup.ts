// Trong chế độ ESM (vm-modules), biến toàn cục `jest` không được inject vào
// phạm vi module như ở CommonJS. Gắn nó vào globalThis để các spec dùng được
// `jest.fn()` mà không cần import thủ công ở từng file.
import { jest } from '@jest/globals';

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
