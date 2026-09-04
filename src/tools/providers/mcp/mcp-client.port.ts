/**
 * Cổng tối thiểu mà {@link MCPToolProvider} cần từ một MCP client. Tách khỏi SDK
 * để test/benchmark bơm fake (PROMPT §29) — module `agent/` không bao giờ thấy
 * type của `@modelcontextprotocol/sdk`.
 */
export interface McpRawToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpCallResult {
  /** Nội dung text đã ghép (content[] type text). */
  text: string;
  structured?: unknown;
  isError: boolean;
}

export interface McpClientPort {
  connect(): Promise<void>;
  listTools(): Promise<McpRawToolDef[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<McpCallResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly serverInfo?: { name: string; version: string };
}

export type McpTransportConfig =
  | {
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | { transport: 'sse'; url: string; headers?: Record<string, string> }
  | {
      transport: 'streamable-http';
      url: string;
      headers?: Record<string, string>;
    };
