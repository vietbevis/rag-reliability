import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { RagModule } from '../rag/rag.module';
import { DatasetLoaderService } from './datasets/dataset-loader.service';
import { DatasetSeedService } from './datasets/dataset-seed.service';
import { AnswerJudgeService } from './metrics/answer-judge.service';
import { BenchmarkService } from './benchmark.service';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';

/**
 * Khung đánh giá (PROMPT §31-37) — PHASE 4 baseline:
 *   - nạp golden dataset JSONL + seed corpus,
 *   - chạy `RagPipelineService.query` từng case,
 *   - tính số liệu retrieval (hàm thuần) + generation (LLM-judge),
 *   - lưu `EvaluationRun` / `EvaluationResult`, so sánh với baseline (regression).
 * Framework đầy đủ (experiments, observability) là PHASE 11-12.
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
  ],
  exports: [EvaluationService, BenchmarkService, DatasetLoaderService],
})
export class EvaluationModule {}
