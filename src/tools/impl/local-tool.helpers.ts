import type { ZodType } from 'zod';
import { LOCAL_PROVIDER_ID } from '../providers/local/local-tool.provider';
import type { ToolDefinition, ToolMetadata } from '../core/tool.types';

/**
 * Dựng `ToolDefinition` cho một local read-only tool với metadata mặc định an
 * toàn (low risk, read-only, không cần confirm). Giảm lặp ở 3 tool builtin.
 */
export function localToolDefinition<TIn, TOut>(args: {
  id: string;
  displayName: string;
  description: string;
  inputSchema: ZodType<TIn>;
  outputSchema: ZodType<TOut>;
  timeoutMs: number;
  maxRetries?: number;
  tags?: string[];
  meta?: Partial<ToolMetadata>;
}): ToolDefinition<TIn, TOut> {
  return {
    id: args.id,
    displayName: args.displayName,
    description: args.description,
    inputSchema: args.inputSchema,
    outputSchema: args.outputSchema,
    metadata: {
      providerId: LOCAL_PROVIDER_ID,
      source: 'local',
      riskLevel: 'low',
      sideEffect: 'read-only',
      requiresConfirmation: false,
      enabled: true,
      tags: args.tags,
      timeoutMs: args.timeoutMs,
      maxRetries: args.maxRetries ?? 0,
      ...args.meta,
    },
  };
}
