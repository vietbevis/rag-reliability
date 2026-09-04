// MCP server stdio tối giản cho e2e integration (test/mcp-live.e2e-spec.ts).
// 1 tool `student_search` read-only, tất định.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-mcp', version: '0.0.1' });

server.registerTool(
  'student_search',
  {
    description: 'Tìm sinh viên theo tên, trả MSSV.',
    inputSchema: { name: z.string() },
    annotations: { readOnlyHint: true },
  },
  ({ name }) => ({
    content: [
      {
        type: 'text',
        text:
          name === 'An'
            ? 'MSSV 2021060001 — lớp CT6A'
            : `Không tìm thấy sinh viên "${name}".`,
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
