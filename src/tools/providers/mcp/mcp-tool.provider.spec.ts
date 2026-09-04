import { Logger } from '@nestjs/common';
import type { ToolExecutionContext } from '../../core/tool.types';
import { createMockMcpProvider, type FakeMcpTool } from './fake-mcp-client';

const ctx: ToolExecutionContext = {
  runId: 'r1',
  stepId: 'r1:0',
  providerId: 'actvn-mcp',
  signal: new AbortController().signal,
  logger: new Logger('test'),
};

const studentSearch: FakeMcpTool = {
  name: 'student_search',
  description: 'Tìm sinh viên theo tên',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  annotations: { readOnlyHint: true },
  handler: (args) => ({
    text: `sinh viên: ${String(args.name)} — MSSV 2021001`,
    structured: { mssv: '2021001', name: args.name },
  }),
};

describe('MCPToolProvider (qua FakeMcpClient)', () => {
  it('discovery: normalize id có namespace + risk từ config', async () => {
    const p = createMockMcpProvider({
      id: 'actvn-mcp',
      tools: [studentSearch],
      defaultRiskLevel: 'medium',
    });
    await p.init();
    const defs = await p.listTools();
    expect(defs[0]!.id).toBe('actvn-mcp.student_search');
    expect(defs[0]!.metadata.source).toBe('mcp');
    expect(defs[0]!.metadata.riskLevel).toBe('medium');
    expect(defs[0]!.metadata.sideEffect).toBe('read-only');
  });

  it('execute: gọi remote, trả structured + evidence', async () => {
    const p = createMockMcpProvider({
      id: 'actvn-mcp',
      tools: [studentSearch],
    });
    await p.init();
    const tool = await p.getTool('actvn-mcp.student_search');
    const res = await tool!.execute({ name: 'An' }, ctx);
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ mssv: '2021001' });
    expect(res.evidence[0]!.text).toContain('MSSV 2021001');
  });

  it('remote isError → success:false MCP_REMOTE_ERROR', async () => {
    const p = createMockMcpProvider({
      id: 'x',
      tools: [
        {
          ...studentSearch,
          handler: () => ({ text: 'lỗi máy chủ nội bộ', isError: true }),
        },
      ],
    });
    await p.init();
    const tool = await p.getTool('x.student_search');
    const res = await tool!.execute({ name: 'z' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('MCP_REMOTE_ERROR');
  });

  it('injectFailure sau N lần → MCP lỗi chuẩn hoá', async () => {
    const p = createMockMcpProvider({
      id: 'x',
      tools: [studentSearch],
      options: {
        injectFailure: {
          student_search: { message: 'timed out', afterCalls: 1 },
        },
      },
    });
    await p.init();
    const tool = await p.getTool('x.student_search');
    expect((await tool!.execute({ name: 'a' }, ctx)).success).toBe(true);
    const res = await tool!.execute({ name: 'a' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('MCP_TIMEOUT');
    expect(res.error?.retryable).toBe(true);
  });

  it('connect lỗi → init ném, healthCheck = unavailable, agent không sập', async () => {
    const p = createMockMcpProvider({
      id: 'x',
      tools: [studentSearch],
      options: { failConnect: 'ECONNREFUSED' },
    });
    await expect(p.init()).rejects.toBeDefined();
    const h = await p.healthCheck();
    expect(h.status).toBe('unavailable');
  });

  it('healthCheck ping OK → healthy; refresh re-discover', async () => {
    const p = createMockMcpProvider({ id: 'x', tools: [studentSearch] });
    await p.init();
    expect((await p.healthCheck()).status).toBe('healthy');
    await p.refresh();
    expect(await p.listTools()).toHaveLength(1);
  });
});
