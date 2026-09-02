import { Logger } from '@nestjs/common';
import type { AgentToolContext } from '../tool.interface';
import { CalculatorTool } from './calculator.tool';

const ctx: AgentToolContext = {
  agentRunId: 'run-1',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

describe('CalculatorTool', () => {
  const tool = new CalculatorTool();

  it('metadata: read, tên snake_case', () => {
    expect(tool.name).toBe('calculator');
    expect(tool.access).toBe('read');
  });

  it('tính đúng và tất định', async () => {
    const a = await tool.execute({ expression: '1234 * 0.15' }, ctx);
    const b = await tool.execute({ expression: '1234 * 0.15' }, ctx);
    expect(a.ok).toBe(true);
    expect(a.data.result).toBe('185.1');
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
    expect(res.data.result).toBe('100');
  });

  it('hàm toán học: sqrt', async () => {
    const res = await tool.execute({ expression: 'sqrt(16) + 2^3' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.data.result).toBe('12');
  });

  it('biểu thức sai cú pháp → ok:false + error, không ném', async () => {
    const res = await tool.execute({ expression: '2 +* 3' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Không tính được/);
    expect(res.evidence).toHaveLength(0);
  });

  it('không cho phép định nghĩa/gọi hàm nguy hiểm', async () => {
    const res = await tool.execute(
      { expression: 'import("child_process")' },
      ctx,
    );
    expect(res.ok).toBe(false);
  });

  it('biểu thức trả về hàm → ok:false', async () => {
    const res = await tool.execute({ expression: 'f(x) = x^2' }, ctx);
    expect(res.ok).toBe(false);
  });
});
