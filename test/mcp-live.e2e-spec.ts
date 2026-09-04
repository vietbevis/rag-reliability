import { join } from 'node:path';
import { SdkMcpClient } from '../src/tools/providers/mcp/sdk-mcp-client';
import { MCPToolProvider } from '../src/tools/providers/mcp/mcp-tool.provider';
import { ToolRegistryService } from '../src/tools/registry/tool-registry.service';

/**
 * Integration MCP THẬT (PROMPT §41 "Live MCP Integration" — suite riêng, KHÔNG
 * trộn với benchmark deterministic). Chạy MCP server stdio thật qua SDK.
 *
 *   npm run test:e2e -- mcp-live
 */
const SERVER = join(process.cwd(), 'test', 'fixtures', 'mcp-echo-server.mjs');

describe('MCP live integration (stdio, SDK thật)', () => {
  function makeProvider(): MCPToolProvider {
    return new MCPToolProvider(
      new SdkMcpClient({
        transport: 'stdio',
        command: 'node',
        args: [SERVER],
      }),
      {
        id: 'echo-mcp',
        transport: 'stdio',
        defaultRiskLevel: 'medium',
        toolTimeoutMs: 10_000,
        toolMaxRetries: 1,
      },
    );
  }

  it('discover + execute + health + close qua registry', async () => {
    const provider = makeProvider();
    const registry = new ToolRegistryService([provider]);
    await registry.bootstrap();

    const defs = registry.list();
    expect(defs.map((d) => d.id)).toContain('echo-mcp.student_search');

    const tool = registry.get('echo-mcp.student_search')!;
    const res = await tool.execute(
      { name: 'An' },
      {
        runId: 'r',
        stepId: 'r:0',
        providerId: 'echo-mcp',
        signal: new AbortController().signal,
        logger: console as never,
      },
    );
    expect(res.success).toBe(true);
    expect(res.evidence[0]!.text).toContain('2021060001');

    const health = await registry.providersHealth();
    expect(health.find((h) => h.providerId === 'echo-mcp')?.status).toBe(
      'healthy',
    );

    await registry.onModuleDestroy();
  }, 30_000);

  it('args sai schema → không gọi remote', async () => {
    const provider = makeProvider();
    await provider.init();
    const tool = (await provider.getTool('echo-mcp.student_search'))!;
    const parsed = tool.definition.inputSchema.safeParse({ name: 123 });
    expect(parsed.success).toBe(false);
    await provider.close();
  }, 30_000);
});
