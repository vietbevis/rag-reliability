import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { EvaluationService } from './evaluation.service';
import { BenchmarkService } from './benchmark.service';
import { ExperimentRunnerService } from './experiments/experiment-runner.service';
import {
  BenchmarkVariantDto,
  RunEvaluationDto,
  RunExperimentDto,
} from './dto/run-evaluation.dto';

@ApiTags('evaluation')
@Controller('evaluation')
export class EvaluationController {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly benchmark: BenchmarkService,
    private readonly experimentRunner: ExperimentRunnerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy đánh giá một golden dataset và lưu EvaluationRun (PROMPT §31)',
  })
  run(@Body() dto: RunEvaluationDto) {
    return this.evaluation.run({
      datasetName: dto.datasetName,
      label: dto.label,
      mode: dto.mode,
      isBaseline: dto.isBaseline,
      topK: dto.topK,
      rerank: dto.rerank,
      strict: dto.strict,
      cite: dto.cite,
      faithfulness: dto.faithfulness,
    });
  }

  @Post('benchmark-rerank')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy dataset 2 lần (rerank off → on), trả metrics before/after + delta (§36)',
  })
  benchmarkRerank(@Body() dto: BenchmarkVariantDto) {
    return this.evaluation.benchmarkRerank({
      datasetName: dto.datasetName,
      topK: dto.topK,
    });
  }

  @Post('benchmark-grounding')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy dataset 2 lần (strict grounding off → on), trả before/after + delta (§36)',
  })
  benchmarkGrounding(@Body() dto: BenchmarkVariantDto) {
    return this.evaluation.benchmarkGrounding({
      datasetName: dto.datasetName,
      topK: dto.topK,
    });
  }

  @Post('benchmark-citation')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy dataset 2 lần (citation off → on), trả before/after + delta (PHASE 9 §29)',
  })
  benchmarkCitation(@Body() dto: BenchmarkVariantDto) {
    return this.evaluation.benchmarkCitation({
      datasetName: dto.datasetName,
      topK: dto.topK,
    });
  }

  @Post('benchmark-faithfulness')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy dataset 2 lần (faithfulness verifier off → on), trả before/after + delta (PHASE 10 §27)',
  })
  benchmarkFaithfulness(@Body() dto: BenchmarkVariantDto) {
    return this.evaluation.benchmarkFaithfulness({
      datasetName: dto.datasetName,
      topK: dto.topK,
    });
  }

  @Get('experiments')
  @ApiOperation({
    summary:
      'Danh sách các experiment chuẩn trong RAG Reliability suite (PROMPT §36)',
  })
  listExperiments() {
    return this.experimentRunner.listExperiments();
  }

  @Post('experiments/run')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chạy một thực nghiệm chuẩn (exp-001 ... exp-007), so sánh before/after + delta (PROMPT §36)',
  })
  runExperiment(@Body() dto: RunExperimentDto) {
    return this.experimentRunner.runExperiment(dto.experimentId, {
      datasetName: dto.datasetName,
      topK: dto.topK,
    });
  }

  @Get('runs')
  @ApiOperation({ summary: 'Liệt kê các run (lọc theo datasetName)' })
  async listRuns(@Query('datasetName') datasetName?: string) {
    const runs = await this.prisma.evaluationRun.findMany({
      where: datasetName ? { dataset: { name: datasetName } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { dataset: { select: { name: true } } },
    });
    return runs.map((r) => ({
      id: r.id,
      datasetName: r.dataset.name,
      label: r.label,
      status: r.status,
      isBaseline: r.isBaseline,
      provider: r.provider,
      model: r.model,
      metrics: r.metrics,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      createdAt: r.createdAt,
    }));
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Chi tiết một run kèm kết quả từng case' })
  async getRun(@Param('id') id: string) {
    const run = await this.prisma.evaluationRun.findUnique({
      where: { id },
      include: {
        dataset: { select: { name: true } },
        results: {
          include: { case: { select: { externalId: true, type: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException(`EvaluationRun ${id} không tồn tại`);
    return {
      id: run.id,
      datasetName: run.dataset.name,
      label: run.label,
      status: run.status,
      isBaseline: run.isBaseline,
      config: run.config,
      provider: run.provider,
      model: run.model,
      metrics: run.metrics,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      results: run.results.map((res) => ({
        caseId: res.case.externalId,
        type: res.case.type,
        passed: res.passed,
        actualStatus: res.actualStatus,
        actualAnswer: res.actualAnswer,
        failureLayer: res.failureLayer,
        metrics: res.metrics,
        notes: res.notes,
      })),
    };
  }

  @Post('runs/:id/compare')
  @HttpCode(200)
  @ApiOperation({
    summary: 'So sánh run với baseline gần nhất, trả cờ regressed (PROMPT §37)',
  })
  compare(@Param('id') id: string) {
    return this.benchmark.compareToBaseline(id);
  }

  @Post('runs/:id/set-baseline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Chốt một run làm baseline chính thức cho dataset tương ứng (PROMPT §35)',
  })
  setBaseline(@Param('id') id: string) {
    return this.benchmark.setBaseline(id);
  }
}
