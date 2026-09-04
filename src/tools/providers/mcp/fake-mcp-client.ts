import type {
  McpCallResult,
  McpClientPort,
  McpRawToolDef,
} from './mcp-client.port';
import { MCPToolProvider } from './mcp-tool.provider';

export interface FakeMcpTool {
  name: string;
  description?: string;
  /** JSON Schema (như MCP server thật trả). */
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpRawToolDef['annotations'];
  /** Handler tất định. Ném ⇒ mô phỏng lỗi remote. */
  handler: (args: Record<string, unknown>) => {
    text: string;
    structured?: unknown;
    isError?: boolean;
  };
}

export interface FakeMcpOptions {
  serverName?: string;
  /** Lỗi khi connect (mô phỏng provider unavailable). */
  failConnect?: string;
  /** Lỗi khi ping (mô phỏng degraded). */
  failPing?: string;
  /** Với tool name → lỗi sau `afterCalls` lần gọi (mô phỏng timeout / flaky). */
  injectFailure?: Record<string, { message: string; afterCalls?: number }>;
}

/**
 * MCP client tất định trong RAM cho test + benchmark (PROMPT §29). Đi qua
 * **đúng** `MCPToolProvider` + schema/error adapter thật — chỉ transport là fake.
 */
export class FakeMcpClient implements McpClientPort {
  serverInfo?: { name: string; version: string };
  private connected = false;
  private readonly callCounts = new Map<string, number>();

  constructor(
    private readonly tools: FakeMcpTool[],
    private readonly opts: FakeMcpOptions = {},
  ) {
    this.serverInfo = { name: opts.serverName ?? 'fake-mcp', version: '0.0.0' };
  }

  connect(): Promise<void> {
    if (this.opts.failConnect) {
      return Promise.reject(new Error(this.opts.failConnect));
    }
    this.connected = true;
    return Promise.resolve();
  }

  listTools(): Promise<McpRawToolDef[]> {
    return Promise.resolve(
      this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
      })),
    );
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const n = (this.callCounts.get(name) ?? 0) + 1;
    this.callCounts.set(name, n);

    const inject = this.opts.injectFailure?.[name];
    if (inject && n > (inject.afterCalls ?? 0)) {
      return Promise.reject(new Error(inject.message));
    }

    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return Promise.reject(
        Object.assign(new Error(`unknown tool ${name}`), { code: -32601 }),
      );
    }
    try {
      const r = tool.handler(args);
      return Promise.resolve({
        text: r.text,
        structured: r.structured,
        isError: r.isError === true,
      });
    } catch (err) {
      return Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  ping(): Promise<void> {
    if (this.opts.failPing)
      return Promise.reject(new Error(this.opts.failPing));
    return this.connected
      ? Promise.resolve()
      : Promise.reject(new Error('chưa connect'));
  }

  close(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }
}

/** Dựng `MCPToolProvider` chạy trên {@link FakeMcpClient}. */
export function createMockMcpProvider(args: {
  id: string;
  tools: FakeMcpTool[];
  options?: FakeMcpOptions;
  defaultRiskLevel?: 'low' | 'medium' | 'high';
  toolTimeoutMs?: number;
  toolMaxRetries?: number;
}): MCPToolProvider {
  return new MCPToolProvider(new FakeMcpClient(args.tools, args.options), {
    id: args.id,
    transport: 'streamable-http',
    defaultRiskLevel: args.defaultRiskLevel ?? 'medium',
    toolTimeoutMs: args.toolTimeoutMs ?? 5000,
    toolMaxRetries: args.toolMaxRetries ?? 1,
  });
}
