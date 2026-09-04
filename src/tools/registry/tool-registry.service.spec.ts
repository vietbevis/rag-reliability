import { z } from 'zod';
import { ConfigError } from '../../common/errors';
import type { AgentTool, ToolDefinition, ToolResult } from '../core/tool.types';
import type {
  ProviderHealth,
  ToolProvider,
} from '../providers/tool-provider.interface';
import { ToolRegistryService } from './tool-registry.service';

function def(id: string, providerId: string): ToolDefinition {
  return {
    id,
    displayName: id,
    description: `tool ${id}`,
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ r: z.string() }),
    metadata: {
      providerId,
      source: providerId === 'local' ? 'local' : 'mcp',
      riskLevel: 'low',
      sideEffect: 'read-only',
      requiresConfirmation: false,
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 0,
    },
  };
}

class StubProvider implements ToolProvider {
  readonly type = 'local' as const;
  initCalls = 0;
  constructor(
    readonly id: string,
    readonly name: string,
    private defs: ToolDefinition[],
    private readonly opts: { failInit?: boolean } = {},
  ) {}
  setDefs(defs: ToolDefinition[]): void {
    this.defs = defs;
  }
  init(): Promise<void> {
    this.initCalls++;
    return this.opts.failInit
      ? Promise.reject(new Error('boom'))
      : Promise.resolve();
  }
  listTools() {
    return Promise.resolve(this.defs);
  }
  getTool(id: string): Promise<AgentTool | undefined> {
    const d = this.defs.find((x) => x.id === id);
    return Promise.resolve(
      d
        ? {
            definition: d,
            execute: (): Promise<ToolResult> =>
              Promise.resolve({ success: true, data: { r: id }, evidence: [] }),
          }
        : undefined,
    );
  }
  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.id,
      status: 'healthy',
      toolCount: this.defs.length,
      checkedAt: 'now',
    });
  }
}

async function reg(providers: ToolProvider[]): Promise<ToolRegistryService> {
  const r = new ToolRegistryService(providers);
  await r.bootstrap();
  return r;
}

describe('ToolRegistryService', () => {
  it('gom tool từ nhiều provider, list() + get() theo canonical id và spec-name', async () => {
    const r = await reg([
      new StubProvider('local', 'Local', [
        def('rag.search', 'local'),
        def('calculator.calculate', 'local'),
      ]),
      new StubProvider('actvn-mcp', 'MCP', [
        def('actvn-mcp.student_search', 'actvn-mcp'),
      ]),
    ]);
    expect(
      r
        .list()
        .map((d) => d.id)
        .sort(),
    ).toEqual([
      'actvn-mcp.student_search',
      'calculator.calculate',
      'rag.search',
    ]);
    expect(r.get('rag.search')).toBeDefined();
    expect(r.get('rag__search')).toBeDefined(); // spec-name (tên hàm LLM)
    expect(r.providerOf('actvn-mcp__student_search')).toBe('actvn-mcp');
  });

  it('toSpecs() sanitize dấu chấm → __', async () => {
    const r = await reg([
      new StubProvider('local', 'Local', [def('rag.search', 'local')]),
    ]);
    const specs = r.toSpecs(r.resolve());
    expect(specs[0]!.name).toBe('rag__search');
  });

  it('collision toolId: giữ provider đầu, KHÔNG throw', async () => {
    const r = await reg([
      new StubProvider('p1', 'P1', [def('x.search', 'p1')]),
      new StubProvider('p2', 'P2', [def('x.search', 'p2')]),
    ]);
    expect(r.list()).toHaveLength(1);
    expect(r.providerOf('x.search')).toBe('p1');
    expect(r.knownCollisions()).toHaveLength(1);
  });

  it('provider init lỗi → bỏ qua tool của nó, provider khác vẫn nạp', async () => {
    const r = await reg([
      new StubProvider('bad', 'Bad', [def('bad.tool', 'bad')], {
        failInit: true,
      }),
      new StubProvider('good', 'Good', [def('good.tool', 'good')]),
    ]);
    expect(r.list().map((d) => d.id)).toEqual(['good.tool']);
  });

  describe('resolve()', () => {
    it('allowlist rỗng → tất cả; lạ → ConfigError', async () => {
      const r = await reg([
        new StubProvider('local', 'L', [
          def('a.x', 'local'),
          def('b.y', 'local'),
        ]),
      ]);
      expect(r.resolve()).toHaveLength(2);
      expect(r.resolve(['a.x'])).toHaveLength(1);
      expect(r.resolve(['a__x'])).toHaveLength(1); // spec-name chấp nhận
      expect(() => r.resolve(['nope'])).toThrow(ConfigError);
    });
  });

  it('setEnabled(false) ẩn tool khỏi list/resolve/get', async () => {
    const r = await reg([
      new StubProvider('local', 'L', [def('a.x', 'local')]),
    ]);
    r.setEnabled('a.x', false);
    expect(r.list()).toHaveLength(0);
    expect(r.get('a.x')).toBeUndefined();
    r.setEnabled('a.x', true);
    expect(r.get('a.x')).toBeDefined();
  });

  it('refreshProvider re-discover tool của đúng provider', async () => {
    const p = new StubProvider('local', 'L', [def('a.x', 'local')]);
    const r = await reg([p]);
    p.setDefs([def('a.x', 'local'), def('a.z', 'local')]);
    await r.refreshProvider('local');
    expect(
      r
        .list()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['a.x', 'a.z']);
  });

  it('providersHealth() gộp mọi provider', async () => {
    const r = await reg([
      new StubProvider('local', 'L', [def('a.x', 'local')]),
    ]);
    const h = await r.providersHealth();
    expect(h[0]).toMatchObject({ providerId: 'local', status: 'healthy' });
  });
});
