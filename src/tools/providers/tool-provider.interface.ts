import type {
  AgentTool,
  ProviderId,
  ToolDefinition,
  ToolId,
  ToolSource,
} from '../core/tool.types';

/**
 * Một nguồn cung cấp tool (target-state.md §4). **MCP KHÔNG phải tool-type đặc
 * biệt — MCP là một Provider.** Agent Core không bao giờ thấy interface này;
 * chỉ `ToolRegistry` biết.
 */
export interface ProviderHealth {
  providerId: ProviderId;
  status: 'healthy' | 'degraded' | 'unavailable';
  detail?: string;
  toolCount: number;
  checkedAt: string;
}

export interface ToolProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type: ToolSource;

  /** connect / handshake (no-op cho local). Lỗi ⇒ provider coi như unavailable. */
  init(): Promise<void>;
  /** Discovery — danh sách định nghĩa tool đã chuẩn hoá. */
  listTools(): Promise<ToolDefinition[]>;
  getTool(id: ToolId): Promise<AgentTool | undefined>;
  healthCheck(): Promise<ProviderHealth>;
  /** Re-discover (MCP server đổi tool). */
  refresh?(): Promise<void>;
  /** Lifecycle — đóng kết nối. */
  close?(): Promise<void>;
}

/** Token DI cho mảng mọi {@link ToolProvider} đã đăng ký. */
export const TOOL_PROVIDERS = Symbol('TOOL_PROVIDERS');
