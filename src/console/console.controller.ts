import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

const CONSOLE_HTML = join(process.cwd(), 'public', 'console.html');

/**
 * Trang test thủ công toàn bộ API (dev tool). Cùng origin với API nên không
 * vướng CORS. Mở ở `http://<host>:<port>/console`.
 */
@ApiExcludeController()
@Controller('console')
@SkipThrottle()
export class ConsoleController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page(): string {
    if (!existsSync(CONSOLE_HTML)) {
      return '<h1>console.html không tìm thấy</h1><p>Cần chạy app từ thư mục gốc dự án (có <code>public/console.html</code>).</p>';
    }
    return readFileSync(CONSOLE_HTML, 'utf8');
  }
}
