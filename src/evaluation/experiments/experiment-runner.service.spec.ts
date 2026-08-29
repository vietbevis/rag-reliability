import { EvaluationService, type BenchmarkComparison } from '../evaluation.service';
import {
  ExperimentRunnerService,
  STANDARD_EXPERIMENTS,
} from './experiment-runner.service';

describe('ExperimentRunnerService', () => {
  let runner: ExperimentRunnerService;
  let mockEvaluation: Partial<EvaluationService>;

  const sampleComparison: BenchmarkComparison = {
    before: {
      runId: 'run-1',
      datasetName: 'answerable',
      mode: 'full',
      status: 'COMPLETED' as any,
      isBaseline: false,
      caseCount: 5,
      provider: 'custom',
      model: 'qwen2.5:7b',
      metrics: { recallAt5: 0.8, faithfulness: 0.8 },
      notReadyCorpus: [],
    },
    after: {
      runId: 'run-2',
      datasetName: 'answerable',
      mode: 'full',
      status: 'COMPLETED' as any,
      isBaseline: false,
      caseCount: 5,
      provider: 'custom',
      model: 'qwen2.5:7b',
      metrics: { recallAt5: 0.9, faithfulness: 0.95 },
      notReadyCorpus: [],
    },
    deltas: [
      { metric: 'recallAt5', before: 0.8, after: 0.9, delta: 0.1 },
      { metric: 'faithfulness', before: 0.8, after: 0.95, delta: 0.15 },
    ],
  };

  beforeEach(() => {
    mockEvaluation = {
      benchmarkRerank: jest.fn().mockResolvedValue(sampleComparison),
      benchmarkGrounding: jest.fn().mockResolvedValue(sampleComparison),
      benchmarkFaithfulness: jest.fn().mockResolvedValue(sampleComparison),
      run: jest.fn().mockResolvedValue(sampleComparison.before),
    };
    runner = new ExperimentRunnerService(mockEvaluation as EvaluationService);
  });

  it('listExperiments: trả danh sách các experiment chuẩn', () => {
    const list = runner.listExperiments();
    expect(list.length).toBe(STANDARD_EXPERIMENTS.length);
    expect(list.map((e) => e.id)).toContain('exp-003');
    expect(list.map((e) => e.id)).toContain('exp-005');
  });

  it('runExperiment exp-003: uỷ quyền cho benchmarkRerank', async () => {
    const res = await runner.runExperiment('exp-003', { datasetName: 'answerable' });
    expect(mockEvaluation.benchmarkRerank).toHaveBeenCalledWith({
      datasetName: 'answerable',
      topK: undefined,
    });
    expect(res.experiment.id).toBe('exp-003');
    expect(res.comparison.deltas.length).toBeGreaterThan(0);
  });

  it('runExperiment exp-005: uỷ quyền cho benchmarkFaithfulness', async () => {
    const res = await runner.runExperiment('exp-005', { datasetName: 'answerable' });
    expect(mockEvaluation.benchmarkFaithfulness).toHaveBeenCalledWith({
      datasetName: 'answerable',
      topK: undefined,
    });
    expect(res.experiment.id).toBe('exp-005');
  });

  it('runExperiment id không tồn tại -> ném NotFoundException', async () => {
    await expect(runner.runExperiment('exp-invalid')).rejects.toThrow('không tồn tại');
  });
});
