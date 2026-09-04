import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  McpCallResult,
  McpClientPort,
  McpRawToolDef,
  McpTransportConfig,
} from './mcp-client.port.js';

/**
 * {@link McpClientPort} chạy trên `@modelcontextprotocol/sdk`. **Chỗ DUY NHẤT
 * trong repo import SDK MCP** (target-state.md §2). Không leak type SDK ra
 * ngoài — chỉ trả các kiểu ở `mcp-client.port`.
 */
export class SdkMcpClient implements McpClientPort {
  private client: Client | null = null;
  serverInfo?: { name: string; version: string };

  constructor(
    private readonly cfg: McpTransportConfig,
    private readonly clientName = 'rag-reliability',
  ) {}

  async connect(): Promise<void> {
    const client = new Client(
      { name: this.clientName, version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(this.buildTransport());
    this.client = client;
    const v = client.getServerVersion();
    if (v) this.serverInfo = { name: v.name, version: v.version };
  }

  async listTools(): Promise<McpRawToolDef[]> {
    const res = await this.require().listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<McpCallResult> {
    const res = await this.require().callTool(
      { name, arguments: args },
      undefined,
      { timeout: opts.timeoutMs, signal: opts.signal },
    );
    const content = Array.isArray(res.content) ? res.content : [];
    const text = content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          (c as { type?: string }).type === 'text',
      )
      .map((c) => c.text)
      .join('\n');
    return {
      text,
      structured: res.structuredContent,
      isError: res.isError === true,
    };
  }

  async ping(): Promise<void> {
    await this.require().ping();
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }

  private require(): Client {
    if (!this.client) throw new Error('MCP client chưa connect');
    return this.client;
  }

  private buildTransport(): Transport {
    switch (this.cfg.transport) {
      case 'stdio':
        return new StdioClientTransport({
          command: this.cfg.command,
          args: this.cfg.args,
          env: this.cfg.env,
        });
      case 'sse':
        return new SSEClientTransport(new URL(this.cfg.url), {
          requestInit: { headers: this.cfg.headers },
        });
      case 'streamable-http':
        return new StreamableHTTPClientTransport(new URL(this.cfg.url), {
          requestInit: { headers: this.cfg.headers },
        });
    }
  }
}
