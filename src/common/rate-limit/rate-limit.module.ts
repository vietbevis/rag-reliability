import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from '../../config/configuration';

/**
 * Rate limiting toàn cục (docs/audit/SECURITY_REVIEW.md — thiếu bảo vệ DoS).
 *
 * Hai "named throttler":
 *   - `default`: trần rộng cho mọi route.
 *   - `rag`: trần chặt hơn, áp thủ công lên route RAG tốn kém bằng
 *     `@Throttle({ rag: { limit, ttl } })` (xem RagController).
 *
 * Tắt hoàn toàn bằng `RATE_LIMIT_ENABLED=false` (dev / sau API gateway đã lo).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const rl = config.get('rateLimit', { infer: true });
        return {
          throttlers: [
            { name: 'default', ttl: rl.ttlMs, limit: rl.limit },
            { name: 'rag', ttl: rl.ttlMs, limit: rl.ragLimit },
          ],
          skipIf: () => !rl.enabled,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
