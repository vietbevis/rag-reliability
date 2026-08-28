import { ConfigService } from '@nestjs/config';
import { loadConfiguration, type AppConfig } from './configuration';

/**
 * `ConfigService` giả cho unit test — build {@link AppConfig} từ một tập env
 * tối thiểu và cho phép override từng nhóm. Không đọc `.env` thật.
 */
export function mockConfigService(
  overrides: Partial<{
    [K in keyof AppConfig]: Partial<AppConfig[K]>;
  }> = {},
  env: Record<string, string> = {},
): ConfigService<AppConfig, true> {
  const prev = process.env;
  process.env = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    LLM_PROVIDER: 'openai',
    EMBEDDING_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test',
    ...env,
  };
  const config = loadConfiguration();
  process.env = prev;

  for (const key of Object.keys(overrides) as (keyof AppConfig)[]) {
    Object.assign(config[key], overrides[key]);
  }

  return {
    get: (key: keyof AppConfig) => config[key],
    getOrThrow: (key: keyof AppConfig) => config[key],
  } as unknown as ConfigService<AppConfig, true>;
}
