import { Global, Module } from '@nestjs/common';
import {
  ConfigModule as NestConfigModule,
  ConfigService,
} from '@nestjs/config';
import { loadConfiguration, type AppConfig } from './configuration';
import { validateEnv } from './env.schema';

/**
 * Accessor có kiểu cho {@link AppConfig}. Nên inject kiểu này thay vì
 * `ConfigService` thô; mọi namespace luôn có giá trị.
 */
export type TypedConfigService = ConfigService<AppConfig, true>;

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
      load: [loadConfiguration],
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
