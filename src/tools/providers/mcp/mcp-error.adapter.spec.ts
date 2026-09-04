import { mcpErrorToToolError } from './mcp-error.adapter';

describe('mcpErrorToToolError', () => {
  it('timeout → MCP_TIMEOUT retryable', () => {
    const e = mcpErrorToToolError(new Error('request timed out'), 'actvn-mcp');
    expect(e.code).toBe('MCP_TIMEOUT');
    expect(e.retryable).toBe(true);
  });

  it('context connect → MCP_CONNECTION_ERROR retryable', () => {
    const e = mcpErrorToToolError(new Error('boom'), 'x', 'connect');
    expect(e.code).toBe('MCP_CONNECTION_ERROR');
    expect(e.retryable).toBe(true);
  });

  it('ECONNREFUSED → MCP_CONNECTION_ERROR', () => {
    const e = mcpErrorToToolError(new Error('connect ECONNREFUSED'), 'x');
    expect(e.code).toBe('MCP_CONNECTION_ERROR');
  });

  it('JSON-RPC -32601 → TOOL_NOT_FOUND non-retryable', () => {
    const e = mcpErrorToToolError(
      Object.assign(new Error('method not found'), { code: -32601 }),
      'x',
    );
    expect(e.code).toBe('TOOL_NOT_FOUND');
    expect(e.retryable).toBe(false);
  });

  it('JSON-RPC -32602 → TOOL_ARGUMENT_ERROR', () => {
    const e = mcpErrorToToolError(
      Object.assign(new Error('invalid params'), { code: -32602 }),
      'x',
    );
    expect(e.code).toBe('TOOL_ARGUMENT_ERROR');
  });

  it('lỗi khác → MCP_REMOTE_ERROR, prefix provider', () => {
    const e = mcpErrorToToolError(new Error('server exploded'), 'actvn-mcp');
    expect(e.code).toBe('MCP_REMOTE_ERROR');
    expect(e.message).toContain('[MCP actvn-mcp]');
  });
});
