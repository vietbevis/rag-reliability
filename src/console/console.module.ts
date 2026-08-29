import { Module } from '@nestjs/common';
import { ConsoleController } from './console.controller';

/** Trang test thủ công API (`GET /console`). Chỉ nên bật ở môi trường dev/staging. */
@Module({
  controllers: [ConsoleController],
})
export class ConsoleModule {}
