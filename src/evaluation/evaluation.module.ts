import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { RagModule } from '../rag/rag.module';
import { DatasetLoaderService } from './datasets/dataset-loader.service';
import { DatasetSeedService } from './datasets/dataset-seed.service';
import { AnswerJudgeService } from './metrics/answer-judge.service';
import { BenchmarkService } from './benchmark.service';
import { EvaluationService } from './evaluation.service';
import { ExperimentRunnerService } from './experiments/experiment-runner.service';
import { EvaluationController } from './evaluation.controller';

/**
 * Khung đánh giá (PROMPT §31-37) — PHASE 4-11:
 *   - nạp golden dataset JSONL + seed corpus,
 *   - chạy `RagPipelineService.query` từng case,
 *   - tính số liệu retrieval (hàm thuần) + generation (LLM-judge),
 *   - lưu `EvaluationRun` / `EvaluationResult`, so sánh với baseline (regression),
 *   - tự động hoá bộ thực nghiệm Experiment 001-008 (PHASE 11).
 */
@Module({
  imports: [RagModule, DocumentsModule],
  controllers: [EvaluationController],
  providers: [
    DatasetLoaderService,
    DatasetSeedService,
    AnswerJudgeService,
    BenchmarkService,
    EvaluationService,
    ExperimentRunnerService,
  ],
  exports: [
    EvaluationService,
    BenchmarkService,
    DatasetLoaderService,
    ExperimentRunnerService,
  ],
})
export class EvaluationModule {}
