// Trong chế độ ESM (vm-modules), biến toàn cục `jest` không được inject vào
// phạm vi module như ở CommonJS. Gắn nó vào globalThis để các spec dùng được
// `jest.fn()` mà không cần import thủ công ở từng file.
import { jest } from '@jest/globals';

// Unit test không có Redis — queue chạy inline (DocumentQueueService.enqueue
// gọi thẳng pipeline). Đặt trước khi bất kỳ module nào được import.
process.env.QUEUE_ENABLED = 'false';

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
