import { Logger } from '@nestjs/common';
import type { ToolExecutionContext } from '../core/tool.types';
import { CurrentTimeTool } from './current-time.tool';

const ctx: ToolExecutionContext = {
  runId: 'run-1',
  stepId: 'run-1:0',
  providerId: 'local',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

describe('CurrentTimeTool', () => {
  const tool = new CurrentTimeTool();

  it('metadata: id namespace, local read-only', () => {
    expect(tool.definition.id).toBe('current_time.now');
    expect(tool.definition.metadata.sideEffect).toBe('read-only');
  });

  it('mặc định UTC, iso hợp lệ, unixMs ~ now', async () => {
    const before = Date.now();
    const res = await tool.execute({}, ctx);
    const after = Date.now();
    expect(res.success).toBe(true);
    expect(res.data?.timezone).toBe('UTC');
    expect(Date.parse(res.data!.iso)).toBeGreaterThanOrEqual(before - 1000);
    expect(res.data!.unixMs).toBeGreaterThanOrEqual(before);
    expect(res.data!.unixMs).toBeLessThanOrEqual(after);
    expect(res.evidence[0]?.kind).toBe('computation');
  });

  it('timezone hợp lệ → localized không rỗng', async () => {
    const res = await tool.execute({ timezone: 'Asia/Ho_Chi_Minh' }, ctx);
    expect(res.success).toBe(true);
    expect(res.data?.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(res.data!.localized.length).toBeGreaterThan(0);
  });

  it('timezone không hợp lệ → success:false + TOOL_ARGUMENT_ERROR', async () => {
    const res = await tool.execute({ timezone: 'Mars/Olympus' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('TOOL_ARGUMENT_ERROR');
  });
});
