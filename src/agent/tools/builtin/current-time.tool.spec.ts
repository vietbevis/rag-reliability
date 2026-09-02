import { Logger } from '@nestjs/common';
import type { AgentToolContext } from '../tool.interface';
import { CurrentTimeTool } from './current-time.tool';

const ctx: AgentToolContext = {
  agentRunId: 'run-1',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

describe('CurrentTimeTool', () => {
  const tool = new CurrentTimeTool();

  it('metadata: read, tên snake_case', () => {
    expect(tool.name).toBe('current_time');
    expect(tool.access).toBe('read');
  });

  it('mặc định UTC, iso hợp lệ, unixMs ~ now', async () => {
    const before = Date.now();
    const res = await tool.execute({}, ctx);
    const after = Date.now();
    expect(res.ok).toBe(true);
    expect(res.data.timezone).toBe('UTC');
    expect(Date.parse(res.data.iso)).toBeGreaterThanOrEqual(before - 1000);
    expect(res.data.unixMs).toBeGreaterThanOrEqual(before);
    expect(res.data.unixMs).toBeLessThanOrEqual(after);
    expect(res.evidence[0]?.kind).toBe('computation');
  });

  it('timezone hợp lệ → localized không rỗng', async () => {
    const res = await tool.execute({ timezone: 'Asia/Ho_Chi_Minh' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.data.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(res.data.localized.length).toBeGreaterThan(0);
  });

  it('timezone không hợp lệ → ok:false + error', async () => {
    const res = await tool.execute({ timezone: 'Mars/Olympus' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Múi giờ không hợp lệ/);
  });
});
