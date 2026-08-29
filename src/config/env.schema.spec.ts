import { validateEnv, EnvValidationError } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  LLM_PROVIDER: 'openai',
  EMBEDDING_PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-test',
};

describe('validateEnv', () => {
  it('chấp nhận cấu hình hợp lệ và áp giá trị mặc định', () => {
    const env = validateEnv({ ...base });
    expect(env.PORT).toBe(3000);
    expect(env.EMBEDDING_DIMENSION).toBe(1024);
    expect(env.QUALITY_THRESHOLD).toBe(0.7);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('ép kiểu số và boolean từ chuỗi env', () => {
    const env = validateEnv({
      ...base,
      PORT: '8080',
      EMBEDDING_DIMENSION: '768',
      SWAGGER_ENABLED: 'false',
    });
    expect(env.PORT).toBe(8080);
    expect(env.EMBEDDING_DIMENSION).toBe(768);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('từ chối khi thiếu DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(
      EnvValidationError,
    );
  });

  it('từ chối DATABASE_URL không phải PostgreSQL', () => {
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/PostgreSQL/);
  });

  it('bắt buộc có API key của provider LLM đang chọn', () => {
    expect(() =>
      validateEnv({ ...base, LLM_PROVIDER: 'anthropic', OPENAI_API_KEY: 'x' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('provider custom cần base URL và model', () => {
    expect(() =>
      validateEnv({
        ...base,
        LLM_PROVIDER: 'custom',
        EMBEDDING_PROVIDER: 'custom',
      }),
    ).toThrow(/CUSTOM_/);

    const env = validateEnv({
      ...base,
      LLM_PROVIDER: 'custom',
      EMBEDDING_PROVIDER: 'custom',
      CUSTOM_LLM_BASE_URL: 'http://localhost:8000/v1',
      CUSTOM_LLM_MODEL: 'local',
      CUSTOM_EMBEDDING_BASE_URL: 'http://localhost:8000/v1',
      CUSTOM_EMBEDDING_MODEL: 'local-embed',
    });
    expect(env.LLM_PROVIDER).toBe('custom');
  });

  it('từ chối threshold ngoài khoảng [0,1]', () => {
    expect(() => validateEnv({ ...base, QUALITY_THRESHOLD: '1.4' })).toThrow(
      EnvValidationError,
    );
  });
});
