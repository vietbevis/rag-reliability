import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { RagModule } from '../rag/rag.module';
import { ReplayService } from './replay.service';

/**
 * Replay (target-state.md §11). Chạy lại `AgentRun` đã ghi để so sánh regression
 * theo trace. Tách khỏi Agent Core.
 */
@Module({
  imports: [AgentModule, RagModule],
  providers: [ReplayService],
  exports: [ReplayService],
})
export class ReplayModule {}
