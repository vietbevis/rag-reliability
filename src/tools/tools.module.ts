import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { RagModule } from '../rag/rag.module';
import { LOCAL_AGENT_TOOLS, type AgentTool } from './core/tool.types';
import { CalculatorTool } from './impl/calculator.tool';
import { CurrentTimeTool } from './impl/current-time.tool';
import { RagSearchTool } from './impl/rag-search.tool';
import { LocalToolProvider } from './providers/local/local-tool.provider';
import { MCPToolProvider } from './providers/mcp/mcp-tool.provider';
import { SdkMcpClient } from './providers/mcp/sdk-mcp-client';
import type { McpTransportConfig } from './providers/mcp/mcp-client.port';
import {
  TOOL_PROVIDERS,
  type ToolProvider,
} from './providers/tool-provider.interface';
import { ToolRegistryService } from './registry/tool-registry.service';

/**
 * Tool Runtime (target-state.md §2). Gom mọi {@link ToolProvider} (local + MCP
 * từ config + future) và expose **một** `ToolRegistryService` cho Agent Core.
 * Agent Core import module này, KHÔNG import provider cụ thể hay MCP SDK.
 */
@Module({
  imports: [RagModule],
  providers: [
    CalculatorTool,
    CurrentTimeTool,
    RagSearchTool,
    {
      provide: LOCAL_AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [CalculatorTool, CurrentTimeTool, RagSearchTool],
    },
    LocalToolProvider,
    {
      provide: TOOL_PROVIDERS,
      useFactory: (
        local: LocalToolProvider,
        config: ConfigService<AppConfig, true>,
      ): ToolProvider[] => {
        const providers: ToolProvider[] = [local];
        const mcp = config.get('mcp', { infer: true });
        if (mcp.enabled) {
          for (const s of mcp.servers.filter((x) => x.enabled)) {
            const transport = buildTransportConfig(s);
            providers.push(
              new MCPToolProvider(new SdkMcpClient(transport), {
                id: s.id,
                transport: s.transport,
                defaultRiskLevel: s.defaultRiskLevel,
                toolTimeoutMs: mcp.toolTimeoutMs,
                toolMaxRetries: mcp.toolMaxRetries,
              }),
            );
          }
        }
        return providers;
      },
      inject: [LocalToolProvider, ConfigService],
    },
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class ToolsModule {}

function buildTransportConfig(
  s: AppConfig['mcp']['servers'][number],
): McpTransportConfig {
  if (s.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: s.command!,
      args: s.args,
      env: s.env,
    };
  }
  return { transport: s.transport, url: s.url!, headers: s.headers };
}
