import { Logger } from '@nestjs/common';
import { CalculatorTool } from '../tools/impl/calculator.tool';
import { makeTestRegistry } from '../tools/testing/local-registry';
import { ReplayToolProvider, type RecordedStep } from './replay-tool.provider';

const ctx = {
  runId: 'r',
  stepId: 'r:0',
  providerId: 'local',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

const recorded: RecordedStep[] = [
  {
    toolName: 'calculator__calculate',
    toolInput: { expression: '2+2' },
    toolOutput: { expression: '2+2', result: '999' }, // cố tình khác kết quả thật
    evidence: [{ kind: 'computation', ref: '2+2', text: '2+2 = 999' }],
    error: null,
  },
];

describe('ReplayToolProvider', () => {
  it('recorded mode: trả kết quả đã ghi (không execute thật)', async () => {
    const live = await makeTestRegistry({ tools: [new CalculatorTool()] });
    const p = new ReplayToolProvider(live, recorded, 'recorded');
    await p.init();
    const tool = await p.getTool('calculator.calculate');
    const res = await tool!.execute({ expression: '2+2' }, ctx);
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ result: '999' });
  });

  it('live-read mode: read-only tool → execute THẬT', async () => {
    const live = await makeTestRegistry({ tools: [new CalculatorTool()] });
    const p = new ReplayToolProvider(live, recorded, 'live-read');
    await p.init();
    const tool = await p.getTool('calculator.calculate');
    const res = await tool!.execute({ expression: '2+2' }, ctx);
    expect(res.data).toMatchObject({ result: '4' }); // kết quả thật
  });

  it('không có bản ghi khớp → lỗi có kiểm soát', async () => {
    const live = await makeTestRegistry({ tools: [new CalculatorTool()] });
    const p = new ReplayToolProvider(live, [], 'recorded');
    await p.init();
    const tool = await p.getTool('calculator.calculate');
    const res = await tool!.execute({ expression: '9+9' }, ctx);
    expect(res.success).toBe(false);
  });

  it('listTools lấy từ registry thật', async () => {
    const live = await makeTestRegistry({ tools: [new CalculatorTool()] });
    const p = new ReplayToolProvider(live, [], 'dry-run');
    expect((await p.listTools()).map((d) => d.id)).toEqual([
      'calculator.calculate',
    ]);
  });
});
