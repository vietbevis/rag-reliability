import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../config/configuration';
import { DatabaseError } from '../common/errors';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Lớp bọc mỏng quanh Prisma Client được sinh ra (Prisma 7, generator
 * `prisma-client`, driver adapter `@prisma/adapter-pg` — theo docs Prisma mới
 * nhất). Quản lý vòng đời kết nối và vài helper hiểu pgvector mà các phase sau
 * xây retrieval lên trên (mọi I/O vector là raw SQL — xem schema.prisma).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppConfig, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('database', { infer: true }).url,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Đã kết nối PostgreSQL');
    } catch (err) {
      throw new DatabaseError('Không kết nối được PostgreSQL', undefined, {
        cause: err,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** True khi extension `vector` đã được cài trong database đích. */
  async isVectorExtensionInstalled(): Promise<boolean> {
    const rows = await this.$queryRaw<Array<{ installed: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS installed
    `;
    return rows[0]?.installed ?? false;
  }

  /** Probe liveness nhẹ, dùng bởi health check. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
