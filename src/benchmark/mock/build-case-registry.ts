import type { AgentTool } from '../../tools/core/tool.types';
import { CalculatorTool } from '../../tools/impl/calculator.tool';
import { CurrentTimeTool } from '../../tools/impl/current-time.tool';
import {
  createMockMcpProvider,
  type FakeMcpTool,
} from '../../tools/providers/mcp/fake-mcp-client';
import type { ToolProvider } from '../../tools/providers/tool-provider.interface';
import { ToolRegistryService } from '../../tools/registry/tool-registry.service';
import { makeTestRegistry } from '../../tools/testing/local-registry';
import type {
  AgentBenchmarkCase,
  MockMcpProviderSpec,
} from '../agent-case.schema';
import { CannedRagSearchTool } from './canned-rag.tool';

/** Dựng ToolRegistry tất định cho một benchmark case (local mock + mock MCP). */
export async function buildCaseRegistry(
  c: AgentBenchmarkCase,
): Promise<ToolRegistryService> {
  const wanted = new Set(
    c.localTools ?? ['calculator.calculate', 'current_time.now', 'rag.search'],
  );
  const localTools: AgentTool[] = [];
  if (wanted.has('calculator.calculate')) localTools.push(new CalculatorTool());
  if (wanted.has('current_time.now')) localTools.push(new CurrentTimeTool());
  if (wanted.has('rag.search')) {
    localTools.push(new CannedRagSearchTool(c.cannedRag));
  }

  const providers: ToolProvider[] = c.mcpProviders.map(toMockProvider);

  return makeTestRegistry({ tools: localTools, providers });
}

function toMockProvider(spec: MockMcpProviderSpec): ToolProvider {
  const tools: FakeMcpTool[] = spec.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: t.readOnly,
      destructiveHint: t.destructive,
    },
    handler: (args) => {
      const match = t.responses.find((r) =>
        Object.entries(r.whenArgs).every(
          ([k, v]: [string, unknown]) =>
            JSON.stringify(args[k]) === JSON.stringify(v),
        ),
      );
      if (match) {
        return {
          text: match.text,
          structured: match.structured,
          isError: match.isError,
        };
      }
      return { text: t.fallbackText };
    },
  }));

  return createMockMcpProvider({
    id: spec.id,
    tools,
    defaultRiskLevel: spec.defaultRiskLevel,
    options: {
      failConnect: spec.failConnect,
      injectFailure: spec.injectFailure,
    },
  });
}
