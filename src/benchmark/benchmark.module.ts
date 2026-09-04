import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { RagModule } from '../rag/rag.module';
import { AnswerJudgeService } from '../evaluation/metrics/answer-judge.service';
import { AgentBenchmarkRunner } from './agent-benchmark.runner';

/**
 * Benchmark framework agent (PROMPT §26). Tách khỏi Agent Core — chỉ tiêu thụ
 * `AgentGraphBuilder` + `AnswerVerificationService` + evaluator. Không có
 * controller (chạy qua CLI `npm run benchmark:agent`).
 */
@Module({
  imports: [AgentModule, RagModule],
  providers: [AgentBenchmarkRunner, AnswerJudgeService],
  exports: [AgentBenchmarkRunner],
})
export class BenchmarkModule {}
