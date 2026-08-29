import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';
import type { AppConfig } from '../config/configuration';

/**
 * Kiểm tra sống của Redis — backend cho BullMQ queue xử lý tài liệu. Chỉ báo
 * `down` (không phá healthcheck ở mức fatal) khi `QUEUE_ENABLED=true` mà ping
 * thất bại: queue chết ⇒ tài liệu upload lên sẽ kẹt ở QUEUED.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly cfg: AppConfig['queue'];
  private client?: Redis;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('queue', { infer: true });
  }

  async check(key = 'redis'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    if (!this.cfg.enabled) {
      return indicator.up({ message: 'queue disabled' });
    }
    try {
      const client = this.getClient();
      // lazyConnect → command đầu tiên kích hoạt kết nối; offline queue (mặc
      // định bật) giữ lệnh cho tới khi ready. Bọc race để connect treo không
      // làm nghẽn healthcheck.
      const pong = await Promise.race([
        client.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('ping timeout (5s)')), 5000),
        ),
      ]);
      return pong === 'PONG'
        ? indicator.up()
        : indicator.down({ message: 'unexpected ping reply' });
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : 'unreachable',
      });
    }
  }

  private getClient(): Redis {
    this.client ??= new Redis({
      host: this.cfg.redis.host,
      port: this.cfg.redis.port,
      password: this.cfg.redis.password,
      db: this.cfg.redis.db,
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      // Thử lại kết nối 1 lần rồi bỏ cuộc — healthcheck không nên treo.
      retryStrategy: (times) => (times > 1 ? null : 200),
    });
    this.client.on('error', (e) =>
      this.logger.debug(`redis health client lỗi: ${e.message}`),
    );
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
