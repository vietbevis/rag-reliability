import type { ProviderId, ToolError } from '../../core/tool.types';

/**
 * Chuẩn hoá lỗi MCP → {@link ToolError} (PROMPT §13). KHÔNG gộp mọi thứ thành
 * "tool failed": phân biệt connection / timeout / protocol / remote / not-found.
 */
export function mcpErrorToToolError(
  err: unknown,
  providerId: ProviderId,
  context: 'connect' | 'list' | 'call' = 'call',
): ToolError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // JSON-RPC error object { code: number, message }.
  const rpcCode =
    err && typeof err === 'object' && 'code' in err
      ? Number(err.code)
      : undefined;

  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('etimedout')
  ) {
    return build('MCP_TIMEOUT', message, true, providerId);
  }
  if (
    context === 'connect' ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('socket hang up') ||
    lower.includes('connection closed') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return build('MCP_CONNECTION_ERROR', message, true, providerId);
  }
  if (rpcCode !== undefined && rpcCode <= -32000) {
    // -32601 method not found, -32602 invalid params…
    if (rpcCode === -32601) {
      return build('TOOL_NOT_FOUND', message, false, providerId);
    }
    if (rpcCode === -32602) {
      return build('TOOL_ARGUMENT_ERROR', message, false, providerId);
    }
    return build('MCP_PROTOCOL_ERROR', message, false, providerId);
  }
  if (lower.includes('not found') || lower.includes('unknown tool')) {
    return build('TOOL_NOT_FOUND', message, false, providerId);
  }
  return build('MCP_REMOTE_ERROR', message, false, providerId);
}

function build(
  code: ToolError['code'],
  message: string,
  retryable: boolean,
  providerId: ProviderId,
): ToolError {
  return {
    code,
    message: `[MCP ${providerId}] ${message}`,
    retryable,
    providerId,
  };
}
