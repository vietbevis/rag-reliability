import { Module } from '@nestjs/common';

/**
 * Agent tool-calling (PHASE 17).
 *
 * Mở rộng RAG pipeline một chiều thành một agent read-first có kiểm soát:
 * task → chọn & gọi tool nhiều bước → tổng hợp câu trả lời grounded + citation,
 * hoặc abstain. Plan chi tiết: `docs/architecture/agent-tools.md`.
 *
 * Bước 17.0 (hiện tại): module rỗng, chỉ để wiring + config nhóm `agent`. Route,
 * graph, tool, persistence được thêm ở các bước 17.1–17.10. Khi
 * `AGENT_ENABLED=false` module này không expose gì — phần RAG thuần không đổi.
 */
@Module({})
export class AgentModule {}
