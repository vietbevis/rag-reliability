import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigError } from '../../common/errors';
import type { ToolSpec } from '../../ai/llm/llm.interface';
import type {
  AgentTool,
  ProviderId,
  ToolDefinition,
  ToolId,
} from '../core/tool.types';
import {
  TOOL_PROVIDERS,
  type ProviderHealth,
  type ToolProvider,
} from '../providers/tool-provider.interface';
import { specNameToToolId, toolIdToSpecName } from './tool-name';

interface Entry {
  providerId: ProviderId;
  definition: ToolDefinition;
  tool: AgentTool;
}

/**
 * Sổ đăng ký tool đa provider (target-state.md §5). Gom tool từ mọi
 * {@link ToolProvider} (local / mcp / future) và expose **một abstraction thống
 * nhất** cho Agent Core — không lộ provider nào. Xử lý:
 * - init lifecycle tất cả provider (lỗi 1 provider ≠ sập boot),
 * - discovery + refresh,
 * - collision `toolId` giữa provider,
 * - resolve theo `toolAllowlist` của request,
 * - enable/disable runtime.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly byId = new Map<ToolId, Entry>();
  private readonly bySpecName = new Map<string, ToolId>();
  private readonly disabled = new Set<ToolId>();
  private readonly collisions: string[] = [];

  constructor(
    @Inject(TOOL_PROVIDERS) private readonly providers: ToolProvider[],
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrap();
  }

  async onModuleDestroy(): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.close?.();
      } catch (err) {
        this.logger.warn(
          `provider ${p.id} close lỗi: ${(err as Error).message}`,
        );
      }
    }
  }

  /** init mọi provider + nạp tool. An toàn gọi lại (dùng cho test). */
  async bootstrap(): Promise<void> {
    this.byId.clear();
    this.bySpecName.clear();
    this.collisions.length = 0;

    for (const provider of this.providers) {
      try {
        await provider.init();
      } catch (err) {
        this.logger.error(
          `provider ${provider.id} init lỗi — bỏ qua tool của nó: ${(err as Error).message}`,
        );
        continue;
      }
      await this.loadProvider(provider);
    }

    this.logger.log(
      `Đã đăng ký ${this.byId.size} tool từ ${this.providers.length} provider` +
        (this.collisions.length
          ? ` · ${this.collisions.length} collision (xem providers())`
          : ''),
    );
  }

  /** Re-discover tool của một provider (MCP server đổi tool). */
  async refreshProvider(providerId: ProviderId): Promise<void> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) {
      throw new ConfigError(`Không có provider "${providerId}"`);
    }
    await provider.refresh?.();
    // Gỡ tool cũ của provider này.
    for (const [id, e] of [...this.byId]) {
      if (e.providerId === providerId) {
        this.byId.delete(id);
        this.bySpecName.delete(toolIdToSpecName(id));
      }
    }
    await this.loadProvider(provider);
    this.logger.log(`refresh provider ${providerId}: ${this.byId.size} tool`);
  }

  private async loadProvider(provider: ToolProvider): Promise<void> {
    let defs: ToolDefinition[];
    try {
      defs = await provider.listTools();
    } catch (err) {
      this.logger.error(
        `provider ${provider.id} listTools lỗi: ${(err as Error).message}`,
      );
      return;
    }

    for (const definition of defs) {
      const existing = this.byId.get(definition.id);
      if (existing) {
        const msg = `collision toolId "${definition.id}": provider "${existing.providerId}" (giữ) vs "${provider.id}" (bỏ)`;
        this.logger.warn(msg);
        this.collisions.push(msg);
        continue;
      }
      const tool = await provider.getTool(definition.id);
      if (!tool) {
        this.logger.warn(
          `provider ${provider.id}: getTool("${definition.id}") trả undefined — bỏ`,
        );
        continue;
      }
      this.byId.set(definition.id, {
        providerId: provider.id,
        definition,
        tool,
      });
      this.bySpecName.set(toolIdToSpecName(definition.id), definition.id);
    }
  }

  // --- truy vấn -------------------------------------------------------

  /** Mọi tool đang bật. */
  list(): ToolDefinition[] {
    return [...this.byId.values()]
      .filter((e) => !this.disabled.has(e.definition.id))
      .map((e) => e.definition);
  }

  /** Tra theo canonical id HOẶC spec-name (tên hàm LLM). */
  get(idOrSpecName: string): AgentTool | undefined {
    const id = this.byId.has(idOrSpecName)
      ? idOrSpecName
      : (this.bySpecName.get(idOrSpecName) ?? specNameToToolId(idOrSpecName));
    const entry = this.byId.get(id);
    if (!entry || this.disabled.has(id)) return undefined;
    return entry.tool;
  }

  providerOf(idOrSpecName: string): ProviderId | undefined {
    const id = this.byId.has(idOrSpecName)
      ? idOrSpecName
      : this.bySpecName.get(idOrSpecName);
    return id ? this.byId.get(id)?.providerId : undefined;
  }

  /**
   * Phân giải danh sách tool cho một request. `allowlist` rỗng → tất cả tool
   * đang bật. Chấp nhận canonical id hoặc spec-name. Tên không tồn tại →
   * `ConfigError` (không im lặng bỏ qua).
   */
  resolve(allowlist?: readonly string[]): AgentTool[] {
    if (!allowlist || allowlist.length === 0) {
      return [...this.byId.values()]
        .filter((e) => !this.disabled.has(e.definition.id))
        .map((e) => e.tool);
    }
    const resolved: AgentTool[] = [];
    const unknown: string[] = [];
    for (const name of allowlist) {
      const tool = this.get(name);
      if (tool) resolved.push(tool);
      else unknown.push(name);
    }
    if (unknown.length > 0) {
      throw new ConfigError(
        `toolAllowlist chứa tool không tồn tại: ${unknown.join(', ')}`,
      );
    }
    return resolved;
  }

  /** Chuyển sang `ToolSpec[]` cho `LlmService.chatWithTools` (tên hàm sanitize). */
  toSpecs(tools: readonly AgentTool[]): ToolSpec[] {
    return tools.map((t) => ({
      name: toolIdToSpecName(t.definition.id),
      description: t.definition.description,
      parameters: t.definition.inputSchema,
    }));
  }

  // --- quản trị ------------------------------------------------------

  setEnabled(id: ToolId, enabled: boolean): void {
    if (!this.byId.has(id)) throw new ConfigError(`Không có tool "${id}"`);
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  async providersHealth(): Promise<ProviderHealth[]> {
    return Promise.all(
      this.providers.map((p) =>
        p.healthCheck().catch((err): ProviderHealth => ({
          providerId: p.id,
          status: 'unavailable',
          detail: (err as Error).message,
          toolCount: 0,
          checkedAt: new Date().toISOString(),
        })),
      ),
    );
  }

  knownCollisions(): readonly string[] {
    return this.collisions;
  }
}
