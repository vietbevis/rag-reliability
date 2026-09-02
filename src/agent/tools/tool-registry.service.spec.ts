import { z } from 'zod';
import { ConfigError } from '../../common/errors';
import type { AgentTool } from './tool.interface';
import { ToolRegistryService } from './tool-registry.service';

function fakeTool(over: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'alpha',
    description: 'tool alpha',
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ r: z.string() }),
    access: 'read',
    timeoutMs: 1000,
    maxRetries: 0,
    execute: jest.fn(),
    ...over,
  };
}

describe('ToolRegistryService', () => {
  it('đăng ký nhiều tool, all() và get() hoạt động', () => {
    const reg = new ToolRegistryService([
      fakeTool({ name: 'alpha' }),
      fakeTool({ name: 'beta' }),
    ]);
    expect(
      reg
        .all()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['alpha', 'beta']);
    expect(reg.get('beta')?.name).toBe('beta');
    expect(reg.get('missing')).toBeUndefined();
  });

  it('từ chối tên không snake_case', () => {
    expect(
      () => new ToolRegistryService([fakeTool({ name: 'CamelCase' })]),
    ).toThrow(ConfigError);
    expect(
      () => new ToolRegistryService([fakeTool({ name: 'has-dash' })]),
    ).toThrow(ConfigError);
  });

  it('từ chối tool trùng tên', () => {
    expect(
      () =>
        new ToolRegistryService([
          fakeTool({ name: 'dup' }),
          fakeTool({ name: 'dup' }),
        ]),
    ).toThrow(/trùng tên/);
  });

  it('từ chối tool access=write (v1 chỉ read)', () => {
    expect(
      () => new ToolRegistryService([fakeTool({ name: 'w', access: 'write' })]),
    ).toThrow(/chỉ chấp nhận read/);
  });

  describe('resolve()', () => {
    const reg = new ToolRegistryService([
      fakeTool({ name: 'alpha' }),
      fakeTool({ name: 'beta' }),
      fakeTool({ name: 'gamma' }),
    ]);

    it('allowlist rỗng / undefined → tất cả tool', () => {
      expect(reg.resolve().length).toBe(3);
      expect(reg.resolve([]).length).toBe(3);
    });

    it('lọc theo allowlist, giữ đúng thứ tự allowlist', () => {
      expect(reg.resolve(['gamma', 'alpha']).map((t) => t.name)).toEqual([
        'gamma',
        'alpha',
      ]);
    });

    it('ném ConfigError khi allowlist có tool lạ', () => {
      expect(() => reg.resolve(['alpha', 'zeta'])).toThrow(
        /không tồn tại: zeta/,
      );
    });
  });

  it('toSpecs() map name/description/inputSchema', () => {
    const reg = new ToolRegistryService([fakeTool({ name: 'alpha' })]);
    const specs = reg.toSpecs(reg.all());
    expect(specs[0]).toMatchObject({
      name: 'alpha',
      description: 'tool alpha',
    });
    expect(specs[0]!.parameters).toBe(reg.get('alpha')!.inputSchema);
  });
});
