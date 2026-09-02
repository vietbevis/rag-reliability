import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { AgentService } from './agent.service';
import { AgentGraphBuilder } from './graph/agent-graph.builder';
import { CalculatorTool } from './tools/builtin/calculator.tool';
import { CurrentTimeTool } from './tools/builtin/current-time.tool';
import { RagSearchTool } from './tools/rag-search.tool';
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
 * registry + 2 builtin tool · 17.3 graph vòng lặp agent ⇄ tool + guard ·
 * 17.4 `rag_search` (bọc RetrievalService). `finalize` (verify), persistence,
 * route ở 17.5–17.10. Khi `AGENT_ENABLED=false` module này chưa expose route.
 */
@Module({
  imports: [RagModule],
  providers: [
    CalculatorTool,
    CurrentTimeTool,
    RagSearchTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [CalculatorTool, CurrentTimeTool, RagSearchTool],
    },
    ToolRegistryService,
    AgentGraphBuilder,
    AgentService,
  ],
  exports: [ToolRegistryService, AgentGraphBuilder, AgentService],
})
export class AgentModule {}
