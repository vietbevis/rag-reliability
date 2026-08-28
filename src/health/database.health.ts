import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';

/**
 * Kiểm tra sống của PostgreSQL và extension pgvector. Service không được báo
 * healthy nếu không kết nối được store hoặc thiếu `vector` — nếu không,
 * retrieval sẽ lỗi ở bước sau một cách khó hiểu (PROMPT §38, §15).
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async pingCheck(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.prisma.ping();
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : 'unreachable',
      });
    }
  }

  async pgvectorCheck(key = 'pgvector'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const installed = await this.prisma.isVectorExtensionInstalled();
      return installed
        ? indicator.up()
        : indicator.down({ message: 'vector extension not installed' });
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : 'check failed',
      });
    }
  }
}
