import { classifyRunFailure, toolErrorToFailureClass } from './failure';

describe('toolErrorToFailureClass', () => {
  it.each([
    ['MCP_TIMEOUT', 'MCP_TIMEOUT'],
    ['MCP_PROTOCOL_ERROR', 'MCP_PROVIDER_ERROR'],
    ['TOOL_ARGUMENT_ERROR', 'TOOL_ARGUMENT_ERROR'],
    ['PERMISSION_DENIED', 'AUTHORIZATION_ERROR'],
    ['LOOP_BLOCKED', 'LOOP_ERROR'],
    ['RAG_RETRIEVAL_ERROR', 'RAG_RETRIEVAL_ERROR'],
  ] as const)('%s → %s', (code, expected) => {
    expect(toolErrorToFailureClass(code)).toBe(expected);
  });
});

describe('classifyRunFailure', () => {
  const base = {
    stopReason: 'final',
    finalStatus: 'GROUNDED' as string | null,
    toolErrorCodes: [] as never[],
    loopBlocked: false,
  };

  it('run đạt (final + GROUNDED) → undefined', () => {
    expect(classifyRunFailure(base)).toBeUndefined();
  });

  it('cancelled → undefined (không phải lỗi)', () => {
    expect(
      classifyRunFailure({ ...base, stopReason: 'cancelled' }),
    ).toBeUndefined();
  });

  it('stopReason=error + message tool-calling → AGENT_DECISION_ERROR', () => {
    const r = classifyRunFailure({
      ...base,
      stopReason: 'error',
      errorMessage: 'model không hỗ trợ tool_choice',
    });
    expect(r?.failureClass).toBe('AGENT_DECISION_ERROR');
  });

  it('budget_steps sau lỗi MCP_TIMEOUT lặp → MCP_TIMEOUT', () => {
    const r = classifyRunFailure({
      ...base,
      stopReason: 'budget_steps',
      finalStatus: null,
      toolErrorCodes: ['MCP_TIMEOUT', 'MCP_TIMEOUT'] as never,
    });
    expect(r?.failureClass).toBe('MCP_TIMEOUT');
  });

  it('no_progress không lỗi tool → LOOP_ERROR', () => {
    const r = classifyRunFailure({
      ...base,
      stopReason: 'no_progress',
      finalStatus: null,
    });
    expect(r?.failureClass).toBe('LOOP_ERROR');
  });

  it('tool_failure_threshold → theo lỗi tool cuối', () => {
    const r = classifyRunFailure({
      ...base,
      stopReason: 'tool_failure_threshold',
      finalStatus: null,
      toolErrorCodes: ['RAG_RETRIEVAL_ERROR'] as never,
    });
    expect(r?.failureClass).toBe('RAG_RETRIEVAL_ERROR');
  });

  it('final nhưng CONFLICTING_EVIDENCE → RAG_GROUNDEDNESS_ERROR', () => {
    const r = classifyRunFailure({
      ...base,
      finalStatus: 'CONFLICTING_EVIDENCE',
    });
    expect(r?.failureClass).toBe('RAG_GROUNDEDNESS_ERROR');
  });
});
