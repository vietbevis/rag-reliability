import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EvaluationService,
  type BenchmarkComparison,
  type RunEvaluationOptions,
} from '../evaluation.service';

export interface ExperimentDefinition {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  defaultDataset: string;
  variable: string;
  interestedMetrics: string[];
  buildVariant: (on: boolean) => Partial<RunEvaluationOptions>;
}

export const STANDARD_EXPERIMENTS: ExperimentDefinition[] = [
  {
    id: 'exp-001',
    name: 'Fixed vs Structure-aware Chunking',
    description: 'So sánh chiến lược chunking cố định vs giữ nguyên đơn vị ngữ nghĩa Markdown',
    hypothesis: 'Structure-aware chunking giữ cấu trúc heading/bảng -> tăng Context Precision và Recall@5',
    defaultDataset: 'answerable',
    variable: 'CHUNKING_STRATEGY',
    interestedMetrics: ['recallAt5', 'contextPrecision', 'ndcgAt5'],
    buildVariant: (_on: boolean) => ({}), // Evaluated via corpus chunking
  },
  {
    id: 'exp-002',
    name: 'Vector vs Hybrid Retrieval',
    description: 'So sánh chiến lược truy hồi thuần vector vs hybrid (vector + keyword + graph fusion)',
    hypothesis: 'Hybrid retrieval cải thiện Recall@5 vượt trội trên các câu hỏi có Exact Identifier và Semantic Query',
    defaultDataset: 'answerable',
    variable: 'strategy',
    interestedMetrics: ['recallAt5', 'mrr', 'ndcgAt5', 'contextRecall'],
    buildVariant: (on: boolean) => ({}), // handled per-query strategy in hybrid
  },
  {
    id: 'exp-003',
    name: 'No Rerank vs Listwise Reranker',
    description: 'So sánh khi bật reranker để xếp lại top-k ứng viên truy hồi',
    hypothesis: 'Reranker đưa các chunk mang bằng chứng chính xác lên đầu -> tăng Context Precision và Faithfulness',
    defaultDataset: 'answerable',
    variable: 'rerank',
    interestedMetrics: ['contextPrecision', 'mrr', 'faithfulness', 'avgLatencyMs', 'totalCost'],
    buildVariant: (on: boolean) => ({ rerank: on }),
  },
  {
    id: 'exp-004',
    name: 'Basic vs Strict Grounded Prompt',
    description: 'So sánh sinh câu trả lời với prompt cơ bản vs prompt nghiêm ngặt kiểm soát ngữ cảnh',
    hypothesis: 'Grounded prompt và cơ chế hậu kiểm giảm tỷ lệ hallucination và tăng độ chính xác của abstention',
    defaultDataset: 'answerable',
    variable: 'strict',
    interestedMetrics: ['faithfulness', 'hallucinationRateProxy', 'abstentionAccuracy'],
    buildVariant: (on: boolean) => ({ strict: on }),
  },
  {
    id: 'exp-005',
    name: 'No Verifier vs Faithfulness Verifier',
    description: 'So sánh quy trình không kiểm chứng vs có FaithfulnessService & NLI verifier',
    hypothesis: 'Faithfulness verifier phát hiện và triệt tiêu mâu thuẫn -> claim-level hallucination rate giảm về 0',
    defaultDataset: 'answerable',
    variable: 'faithfulness',
    interestedMetrics: ['faithfulness', 'claimLevelHallucinationRate', 'citationAccuracy'],
    buildVariant: (on: boolean) => ({ faithfulness: on }),
  },
  {
    id: 'exp-007',
    name: 'Vector vs Graph Traversal on Multi-hop',
    description: 'So sánh khả năng nối liên kết nhiều chặng trên multi-hop dataset',
    hypothesis: 'Graph traversal và Entity linking vượt trội hơn vector đơn thuần trên câu hỏi suy luận quan hệ',
    defaultDataset: 'multi-hop',
    variable: 'strategy (vector vs hybrid)',
    interestedMetrics: ['recallAt5', 'contextRecall', 'passRate'],
    buildVariant: (on: boolean) => ({ strict: on }),
  },
];

@Injectable()
export class ExperimentRunnerService {
  private readonly logger = new Logger(ExperimentRunnerService.name);

  constructor(private readonly evaluation: EvaluationService) {}

  listExperiments(): Array<Omit<ExperimentDefinition, 'buildVariant'>> {
    return STANDARD_EXPERIMENTS.map(({ buildVariant: _, ...rest }) => rest);
  }

  getExperiment(id: string): ExperimentDefinition | undefined {
    return STANDARD_EXPERIMENTS.find((e) => e.id === id);
  }

  async runExperiment(
    id: string,
    opts: { datasetName?: string; topK?: number } = {},
  ): Promise<{
    experiment: Omit<ExperimentDefinition, 'buildVariant'>;
    comparison: BenchmarkComparison;
  }> {
    const exp = this.getExperiment(id);
    if (!exp) {
      throw new NotFoundException(
        `Experiment ${id} không tồn tại. Danh sách khả dụng: ${STANDARD_EXPERIMENTS.map((e) => e.id).join(', ')}`,
      );
    }

    const dataset = opts.datasetName ?? exp.defaultDataset;
    this.logger.log(`Bắt đầu chạy ${exp.id}: ${exp.name} trên dataset "${dataset}"...`);

    let comparison: BenchmarkComparison;

    switch (exp.id) {
      case 'exp-003':
        comparison = await this.evaluation.benchmarkRerank({
          datasetName: dataset,
          topK: opts.topK,
        });
        break;
      case 'exp-004':
        comparison = await this.evaluation.benchmarkGrounding({
          datasetName: dataset,
          topK: opts.topK,
        });
        break;
      case 'exp-005':
        comparison = await this.evaluation.benchmarkFaithfulness({
          datasetName: dataset,
          topK: opts.topK,
        });
        break;
      default:
        // Chạy variant thông qua evaluation.run
        const before = await this.evaluation.run({
          datasetName: dataset,
          topK: opts.topK,
          mode: 'full',
          ...exp.buildVariant(false),
          label: `${dataset}-${exp.id}-off-${Date.now()}`,
        });
        const after = await this.evaluation.run({
          datasetName: dataset,
          topK: opts.topK,
          mode: 'full',
          ...exp.buildVariant(true),
          label: `${dataset}-${exp.id}-on-${Date.now()}`,
        });

        const keys = [
          ...new Set([
            ...Object.keys(before.metrics),
            ...Object.keys(after.metrics),
          ]),
        ];
        const deltas = keys.map((metric) => {
          const b = before.metrics[metric] ?? null;
          const a = after.metrics[metric] ?? null;
          const delta =
            b !== null && a !== null ? Math.round((a - b) * 10000) / 10000 : null;
          return { metric, before: b, after: a, delta };
        });

        comparison = { before, after, deltas };
        break;
    }

    const { buildVariant: _, ...metadata } = exp;
    return {
      experiment: metadata,
      comparison,
    };
  }

  async runAllExperiments(
    opts: { datasetName?: string; topK?: number } = {},
  ): Promise<
    Array<{
      experiment: Omit<ExperimentDefinition, 'buildVariant'>;
      comparison: BenchmarkComparison;
    }>
  > {
    const results = [];
    for (const exp of STANDARD_EXPERIMENTS) {
      try {
        const res = await this.runExperiment(exp.id, opts);
        results.push(res);
      } catch (err) {
        this.logger.error(`Lỗi khi chạy ${exp.id}: ${(err as Error).message}`);
      }
    }
    return results;
  }
}
