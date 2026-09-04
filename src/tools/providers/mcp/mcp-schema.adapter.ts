import { z } from 'zod';
import type { ProviderId, ToolDefinition } from '../../core/tool.types';
import { jsonSchemaToZod } from './json-schema-to-zod';
import type { McpRawToolDef } from './mcp-client.port';

export interface McpAdapterOptions {
  providerId: ProviderId;
  /** Rủi ro mặc định — KHÔNG tin server tự khai (target-state.md §4.2). */
  defaultRiskLevel: 'low' | 'medium' | 'high';
  timeoutMs: number;
  maxRetries: number;
}

/**
 * MCP tool def (JSON Schema) → {@link ToolDefinition} chuẩn hoá. Namespace id
 * theo provider để chống collision (`actvn-mcp.student_search`). Suy `riskLevel`
 * / `sideEffect` từ `annotations` NHƯNG chặn trần bằng `defaultRiskLevel`.
 */
export function mcpToolToDefinition(
  raw: McpRawToolDef,
  opts: McpAdapterOptions,
): ToolDefinition {
  const inputSchema = jsonSchemaToZod(
    raw.inputSchema as Parameters<typeof jsonSchemaToZod>[0],
  );
  const outputSchema = raw.outputSchema
    ? jsonSchemaToZod(raw.outputSchema)
    : z.unknown();

  const readOnly = raw.annotations?.readOnlyHint === true;
  const destructive = raw.annotations?.destructiveHint === true;

  // riskLevel: destructive → high; read-only → không dưới defaultRiskLevel;
  // còn lại → defaultRiskLevel. KHÔNG cho server hạ risk xuống dưới mặc định.
  const riskLevel: 'low' | 'medium' | 'high' = destructive
    ? 'high'
    : opts.defaultRiskLevel;

  const sideEffect = readOnly && !destructive ? 'read-only' : 'side-effecting';

  return {
    id: `${opts.providerId}.${raw.name}`,
    displayName: raw.annotations?.title ?? raw.name,
    description: raw.description ?? `MCP tool ${raw.name} (${opts.providerId})`,
    inputSchema,
    outputSchema,
    metadata: {
      providerId: opts.providerId,
      source: 'mcp',
      riskLevel,
      sideEffect,
      requiresConfirmation: riskLevel === 'high',
      enabled: true,
      tags: ['mcp', opts.providerId],
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    },
  };
}
