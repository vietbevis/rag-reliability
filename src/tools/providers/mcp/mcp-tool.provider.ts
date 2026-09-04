import { Logger } from '@nestjs/common';
import { withTimeout } from '../../../common/utils';
import type {
  AgentTool,
  ProviderId,
  ToolDefinition,
  ToolExecutionContext,
  ToolId,
  ToolResult,
} from '../../core/tool.types';
import type { ProviderHealth, ToolProvider } from '../tool-provider.interface';
import type { McpClientPort, McpTransportConfig } from './mcp-client.port';
import { mcpErrorToToolError } from './mcp-error.adapter';
import {
  mcpToolToDefinition,
  type McpAdapterOptions,
} from './mcp-schema.adapter';

export interface McpProviderOptions {
  id: ProviderId;
  name?: string;
  transport: McpTransportConfig['transport'];
  defaultRiskLevel: 'low' | 'medium' | 'high';
  toolTimeoutMs: number;
  toolMaxRetries: number;
}

/**
 * Provider bọc một MCP server (target-state.md §4.2). Nhiệm vụ: connect →
 * discover → normalize schema → execute → normalize error → health → lifecycle
 * → refresh. **Không leak type MCP SDK** — chỉ dùng {@link McpClientPort}.
 * Provider chết KHÔNG làm sập agent: `init` lỗi ⇒ `unavailable`, registry bỏ
 * qua tool của nó.
 */
export class MCPToolProvider implements ToolProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type = 'mcp' as const;

  private readonly logger: Logger;
  private readonly defs = new Map<ToolId, ToolDefinition>();
  private connected = false;
  private lastError?: string;

  constructor(
    private readonly client: McpClientPort,
    private readonly opts: McpProviderOptions,
  ) {
    this.id = opts.id;
    this.name = opts.name ?? `MCP: ${opts.id}`;
    this.logger = new Logger(`MCPToolProvider:${opts.id}`);
  }

  private get adapterOpts(): McpAdapterOptions {
    return {
      providerId: this.id,
      defaultRiskLevel: this.opts.defaultRiskLevel,
      timeoutMs: this.opts.toolTimeoutMs,
      maxRetries: this.opts.toolMaxRetries,
    };
  }

  async init(): Promise<void> {
    try {
      await this.client.connect();
      this.connected = true;
      await this.discover();
      this.logger.log(
        `connected → ${this.client.serverInfo?.name ?? '?'} · ${this.defs.size} tool`,
      );
    } catch (err) {
      this.connected = false;
      const norm = mcpErrorToToolError(err, this.id, 'connect');
      this.lastError = norm.message;
      this.logger.error(`init lỗi: ${norm.message}`);
      // Ném để registry ghi WARN + bỏ qua provider này (agent vẫn chạy).
      throw new Error(norm.message, { cause: err });
    }
  }

  private async discover(): Promise<void> {
    const raw = await this.client.listTools();
    this.defs.clear();
    for (const t of raw) {
      const def = mcpToolToDefinition(t, this.adapterOpts);
      this.defs.set(def.id, def);
    }
  }

  listTools(): Promise<ToolDefinition[]> {
    return Promise.resolve([...this.defs.values()]);
  }

  getTool(id: ToolId): Promise<AgentTool | undefined> {
    const definition = this.defs.get(id);
    if (!definition) return Promise.resolve(undefined);
    // Tên tool bên server = phần sau "providerId.".
    const remoteName = id.slice(this.id.length + 1);
    return Promise.resolve({
      definition,
      execute: (input, ctx) => this.callRemote(remoteName, input, ctx),
    });
  }

  private async callRemote(
    remoteName: string,
    input: unknown,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!this.connected) {
      return {
        success: false,
        error: mcpErrorToToolError(
          new Error('provider chưa connect'),
          this.id,
          'connect',
        ),
        evidence: [],
      };
    }
    try {
      const res = await withTimeout(
        (signal) =>
          this.client.callTool(
            remoteName,
            (input ?? {}) as Record<string, unknown>,
            { timeoutMs: this.opts.toolTimeoutMs, signal },
          ),
        this.opts.toolTimeoutMs,
        `mcp.${this.id}.${remoteName}`,
      );
      if (res.isError) {
        return {
          success: false,
          error: mcpErrorToToolError(
            new Error(res.text || 'tool trả isError'),
            this.id,
            'call',
          ),
          evidence: [],
        };
      }
      return {
        success: true,
        data: res.structured ?? res.text,
        evidence: [
          {
            kind: 'computation',
            ref: `mcp:${this.id}.${remoteName}`,
            text: res.text || JSON.stringify(res.structured ?? {}),
          },
        ],
        metadata: { source: `mcp:${this.id}` },
      };
    } catch (err) {
      ctx.logger.warn(
        `mcp ${this.id}.${remoteName} lỗi: ${(err as Error).message}`,
      );
      return {
        success: false,
        error: mcpErrorToToolError(err, this.id, 'call'),
        evidence: [],
      };
    }
  }

  async refresh(): Promise<void> {
    if (!this.connected) {
      await this.init();
      return;
    }
    await this.discover();
  }

  async healthCheck(): Promise<ProviderHealth> {
    const base = {
      providerId: this.id,
      toolCount: this.defs.size,
      checkedAt: new Date().toISOString(),
    };
    if (!this.connected) {
      return { ...base, status: 'unavailable', detail: this.lastError };
    }
    try {
      await this.client.ping();
      return { ...base, status: 'healthy' };
    } catch (err) {
      return {
        ...base,
        status: 'degraded',
        detail: (err as Error).message,
      };
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close().catch(() => undefined);
      this.connected = false;
    }
  }
}
