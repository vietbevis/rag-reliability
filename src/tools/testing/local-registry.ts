import type { AgentTool } from '../core/tool.types';
import { LOCAL_PROVIDER_ID } from '../providers/local/local-tool.provider';
import type {
  ProviderHealth,
  ToolProvider,
} from '../providers/tool-provider.interface';
import { ToolRegistryService } from '../registry/tool-registry.service';

/** Provider local tối giản cho unit test (không cần DI). */
class TestLocalProvider implements ToolProvider {
  readonly id = LOCAL_PROVIDER_ID;
  readonly name = 'test-local';
  readonly type = 'local' as const;
  constructor(private readonly tools: AgentTool[]) {}
  init(): Promise<void> {
    return Promise.resolve();
  }
  listTools() {
    return Promise.resolve(this.tools.map((t) => t.definition));
  }
  getTool(id: string) {
    return Promise.resolve(this.tools.find((t) => t.definition.id === id));
  }
  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.id,
      status: 'healthy',
      toolCount: this.tools.length,
      checkedAt: new Date().toISOString(),
    });
  }
}

/**
 * Dựng `ToolRegistryService` đã bootstrap với các provider cho sẵn — cho unit
 * test. `tools` (không có provider) được bọc trong một local provider.
 */
export async function makeTestRegistry(args: {
  tools?: AgentTool[];
  providers?: ToolProvider[];
}): Promise<ToolRegistryService> {
  const providers: ToolProvider[] = [...(args.providers ?? [])];
  if (args.tools && args.tools.length > 0) {
    providers.unshift(new TestLocalProvider(args.tools));
  }
  const registry = new ToolRegistryService(providers);
  await registry.bootstrap();
  return registry;
}
