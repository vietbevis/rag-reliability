import { Module } from '@nestjs/common';
import { CalculatorTool } from './tools/builtin/calculator.tool';
import { CurrentTimeTool } from './tools/builtin/current-time.tool';
import { AGENT_TOOLS, type AgentTool } from './tools/tool.interface';
import { ToolRegistryService } from './tools/tool-registry.service';

/**
 * Agent tool-calling (PHASE 17).
 *
 * Mở rộng RAG pipeline một chiều thành một agent read-first có kiểm soát:
 * task → chọn & gọi tool nhiều bước → tổng hợp câu trả lời grounded + citation,
 * hoặc abstain. Plan chi tiết: `docs/architecture/agent-tools.md`.
 *
 * Tiến độ: 17.0 config + wiring · 17.1 tool-calling ở lớp LLM · 17.2 lớp tool +
 * registry + 2 builtin tool. Graph, RAG tool, persistence, route ở 17.3–17.10.
 * Khi `AGENT_ENABLED=false` module này chưa expose route nào.
 */
@Module({
  providers: [
    CalculatorTool,
    CurrentTimeTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [CalculatorTool, CurrentTimeTool],
    },
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class AgentModule {}
