import { Logger } from '@nestjs/common';
import type { ToolExecutionContext } from '../core/tool.types';
import { CalculatorTool } from './calculator.tool';

const ctx: ToolExecutionContext = {
  runId: 'run-1',
  stepId: 'run-1:0',
  providerId: 'local',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

describe('CalculatorTool', () => {
  const tool = new CalculatorTool();

  it('metadata: local, read-only, low risk, id có namespace', () => {
    expect(tool.definition.id).toBe('calculator.calculate');
    expect(tool.definition.metadata.source).toBe('local');
    expect(tool.definition.metadata.riskLevel).toBe('low');
    expect(tool.definition.metadata.sideEffect).toBe('read-only');
  });

  it('tính đúng và tất định', async () => {
    const a = await tool.execute({ expression: '1234 * 0.15' }, ctx);
    const b = await tool.execute({ expression: '1234 * 0.15' }, ctx);
    expect(a.success).toBe(true);
    expect(a.data?.result).toBe('185.1');
    expect(a.data).toEqual(b.data);
  });

  it('trả evidence kind=computation', async () => {
    const res = await tool.execute({ expression: '(3 + 4) / 7 * 100' }, ctx);
    expect(res.evidence).toEqual([
      {
        kind: 'computation',
        ref: '(3 + 4) / 7 * 100',
        text: expect.any(String),
      },
    ]);
    expect(res.data?.result).toBe('100');
  });

  it('hàm toán học: sqrt', async () => {
    const res = await tool.execute({ expression: 'sqrt(16) + 2^3' }, ctx);
    expect(res.success).toBe(true);
    expect(res.data?.result).toBe('12');
  });

  it('biểu thức sai cú pháp → success:false + error code, không ném', async () => {
    const res = await tool.execute({ expression: '2 +* 3' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('TOOL_EXECUTION_ERROR');
    expect(res.error?.message).toMatch(/Không tính được/);
    expect(res.evidence).toHaveLength(0);
  });

  it('không cho phép hàm nguy hiểm', async () => {
    const res = await tool.execute(
      { expression: 'import("child_process")' },
      ctx,
    );
    expect(res.success).toBe(false);
  });

  it('biểu thức trả về hàm → success:false', async () => {
    const res = await tool.execute({ expression: 'f(x) = x^2' }, ctx);
    expect(res.success).toBe(false);
  });
});
