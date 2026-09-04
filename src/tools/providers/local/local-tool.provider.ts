import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LOCAL_AGENT_TOOLS,
  type AgentTool,
  type ToolDefinition,
  type ToolId,
} from '../../core/tool.types';
import type { ProviderHealth, ToolProvider } from '../tool-provider.interface';

export const LOCAL_PROVIDER_ID = 'local';

/**
 * Provider cho tool chạy trực tiếp trong ứng dụng (target-state.md §4.1):
 * `rag.search`, `calculator.calculate`, `current_time.now`. Agent dùng nó
 * **giống hệt** `MCPToolProvider`.
 */
@Injectable()
export class LocalToolProvider implements ToolProvider {
  readonly id = LOCAL_PROVIDER_ID;
  readonly name = 'Local tools';
  readonly type = 'local' as const;

  private readonly logger = new Logger(LocalToolProvider.name);
  private readonly byId = new Map<ToolId, AgentTool>();

  constructor(@Inject(LOCAL_AGENT_TOOLS) tools: AgentTool[]) {
    for (const tool of tools) this.byId.set(tool.definition.id, tool);
  }

  init(): Promise<void> {
    this.logger.log(
      `Local provider: ${this.byId.size} tool — ${[...this.byId.keys()].join(', ')}`,
    );
    return Promise.resolve();
  }

  listTools(): Promise<ToolDefinition[]> {
    return Promise.resolve([...this.byId.values()].map((t) => t.definition));
  }

  getTool(id: ToolId): Promise<AgentTool | undefined> {
    return Promise.resolve(this.byId.get(id));
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.id,
      status: 'healthy',
      toolCount: this.byId.size,
      checkedAt: new Date().toISOString(),
    });
  }
}
