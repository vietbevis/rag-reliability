import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import type { AppConfig } from '../config/configuration';
import type { HallucinationRootCause } from '../common/types';
import { EvaluationRunStatus, Prisma } from '../generated/prisma/client';
import { RagPipelineService } from '../rag/pipeline/rag-pipeline.service';
import { RetrievalService } from '../rag/retrieval/retrieval.service';
import { LlmService } from '../ai/llm/llm.service';
import { DatasetLoaderService } from './datasets/dataset-loader.service';
import { DatasetSeedService } from './datasets/dataset-seed.service';
import type { EvalCase } from './datasets/case.schema';
import {
  contextPrecision,
  contextRecall,
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from './metrics/retrieval-metrics';
import {
  abstentionCorrect,
  citationAccuracy,
  hallucinationRateProxy,
  isAbstained,
  meanBool,
  meanIgnoringNull,
  type AnswerStatus,
  type CaseOutcome,
} from './metrics/generation-metrics';
import { AnswerJudgeService } from './metrics/answer-judge.service';

export type EvalMode = 'retrieval' | 'full';

export interface RunEvaluationOptions {
  datasetName: string;
  label?: string;
  isBaseline?: boolean;
  mode?: EvalMode;
  topK?: number;
  /** Ghi đè `RERANK_ENABLED` cho run này (benchmark before/after — §36). */
  rerank?: boolean;
  /** Ghi đè `RAG_STRICT_GROUNDING` cho run này (§36). */
  strict?: boolean;
}

export interface BenchmarkComparison {
  before: EvaluationRunSummary;
  after: EvaluationRunSummary;
  deltas: Array<{
    metric: string;
    before: number | null;
    after: number | null;
    delta: number | null;
  }>;
}

export interface EvaluationRunSummary {
  runId: string;
  datasetName: string;
  mode: EvalMode;
  status: EvaluationRunStatus;
  isBaseline: boolean;
  caseCount: number;
  provider: string | null;
  model: string | null;
  metrics: Record<string, number | null>;
  notReadyCorpus: string[];
}

/** K cố định cho các số liệu retrieval ở baseline (PROMPT §33). */
const K = 5;

/**
 * Chạy đánh giá một golden dataset (PROMPT §31-35). Với mỗi case: seed corpus,
 * gọi `RagPipelineService.query`, tính số liệu retrieval + generation, lưu
 * `EvaluationResult`, tổng hợp vào `EvaluationRun`. Đây là nền cho baseline
 * (§35) và regression benchmark (§37).
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: DatasetLoaderService,
    private readonly seeder: DatasetSeedService,
    private readonly pipeline: RagPipelineService,
    private readonly retrieval: RetrievalService,
    private readonly judge: AnswerJudgeService,
    private readonly llm: LlmService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async run(opts: RunEvaluationOptions): Promise<EvaluationRunSummary> {
    const mode: EvalMode = opts.mode ?? 'full';
    const rag = this.config.get('rag', { infer: true });
    const topK = opts.topK ?? rag.retrievalTopK;

    const cases = this.loader.load(opts.datasetName);
    const seed = await this.seeder.seed(opts.datasetName, cases);
    const docIdToSource = invert(seed.sourceToDocId);

    const label =
      opts.label ??
      `${opts.datasetName}-${mode}-${new Date().toISOString().slice(0, 19)}`;

    const run = await this.prisma.evaluationRun.create({
      data: {
        datasetId: seed.datasetId,
        label,
        status: EvaluationRunStatus.RUNNING,
        isBaseline: opts.isBaseline ?? false,
        startedAt: new Date(),
        config: {
          mode,
          topK,
          chunkingStrategy: this.config.get('chunking', { infer: true })
            .strategy,
          minRelevance: rag.minRelevance,
          rerank:
            opts.rerank ?? this.config.get('rerank', { infer: true }).enabled,
          rerankProvider: this.config.get('rerank', { infer: true }).provider,
          strict:
            opts.strict ?? this.config.get('grounding', { infer: true }).strict,
        },
        provider: this.llm.activeProvider,
      },
    });

    try {
      const outcomes: PerCase[] = [];
      for (const c of cases) {
        outcomes.push(
          await this.evaluateCase(c, {
            runId: run.id,
            datasetId: seed.datasetId,
            mode,
            topK,
            rerank: opts.rerank,
            strict: opts.strict,
            sourceToDocId: seed.sourceToDocId,
            docIdToSource,
          }),
        );
      }

      const metrics = this.aggregate(outcomes, cases);
      const model = outcomes.find((o) => o.model)?.model ?? null;

      await this.prisma.evaluationRun.update({
        where: { id: run.id },
        data: {
          status: EvaluationRunStatus.COMPLETED,
          finishedAt: new Date(),
          metrics: metrics,
          model,
        },
      });

      return {
        runId: run.id,
        datasetName: opts.datasetName,
        mode,
        status: EvaluationRunStatus.COMPLETED,
        isBaseline: run.isBaseline,
        caseCount: cases.length,
        provider: run.provider,
        model,
        metrics,
        notReadyCorpus: seed.notReady,
      };
    } catch (err) {
      this.logger.error(`Eval run ${run.id} lỗi: ${(err as Error).message}`);
      await this.prisma.evaluationRun.update({
        where: { id: run.id },
        data: { status: EvaluationRunStatus.FAILED, finishedAt: new Date() },
      });
      throw err;
    }
  }

  /**
   * Benchmark một biến thể before/after (PROMPT §36-37): chạy cùng dataset 2 lần
   * (`mode: 'full'`), lần đầu tắt biến thể, lần sau bật — rồi so số liệu. Chứng
   * minh cải tiến có đủ bù cost/latency hay không.
   */
  private async benchmarkVariant(
    datasetName: string,
    topK: number | undefined,
    key: string,
    build: (on: boolean) => Partial<RunEvaluationOptions>,
  ): Promise<BenchmarkComparison> {
    const before = await this.run({
      datasetName,
      topK,
      mode: 'full',
      ...build(false),
      label: `${datasetName}-${key}-off-${stamp()}`,
    });
    const after = await this.run({
      datasetName,
      topK,
      mode: 'full',
      ...build(true),
      label: `${datasetName}-${key}-on-${stamp()}`,
    });

    const keys = [
      ...new Set([
        ...Object.keys(before.metrics),
        ...Object.keys(after.metrics),
      ]),
    ].sort();
    const deltas = keys.map((metric) => {
      const b = numOrNull(before.metrics[metric]);
      const a = numOrNull(after.metrics[metric]);
      return {
        metric,
        before: b,
        after: a,
        delta: b !== null && a !== null ? round(a - b) : null,
      };
    });
    return { before, after, deltas };
  }

  benchmarkRerank(opts: {
    datasetName: string;
    topK?: number;
  }): Promise<BenchmarkComparison> {
    return this.benchmarkVariant(
      opts.datasetName,
      opts.topK,
      'rerank',
      (on) => ({
        rerank: on,
      }),
    );
  }

  /** Benchmark grounded generation nghiêm ngặt (PHASE 8) before/after. */
  benchmarkGrounding(opts: {
    datasetName: string;
    topK?: number;
  }): Promise<BenchmarkComparison> {
    return this.benchmarkVariant(
      opts.datasetName,
      opts.topK,
      'strict',
      (on) => ({ strict: on }),
    );
  }

  // --- một case --------------------------------------------------------

  private async evaluateCase(
    c: EvalCase,
    ctx: {
      runId: string;
      datasetId: string;
      mode: EvalMode;
      topK: number;
      rerank?: boolean;
      strict?: boolean;
      sourceToDocId: Map<string, string>;
      docIdToSource: Map<string, string>;
    },
  ): Promise<PerCase> {
    const caseRow = await this.prisma.evaluationCase.findFirstOrThrow({
      where: { datasetId: ctx.datasetId, externalId: c.id },
      select: { id: true },
    });

    // `retrieval` mode = CHỈ đo truy hồi, KHÔNG gọi LLM sinh câu trả lời
    // (npm run evaluate:retrieval — nhanh, không tốn token).
    const retrievalOnly = ctx.mode === 'retrieval';

    let retrievedChunks: Array<{ documentId: string }>;
    let status: AnswerStatus | null;
    let answer: string | null;
    let citations: Array<{ documentId: string }>;
    let latencyMs: number;
    let estimatedCost: number;
    let model: string | null;
    let errorNote: string | null;

    if (retrievalOnly) {
      const r = await this.retrieval.retrieve({
        query: c.question,
        topK: ctx.topK,
        log: false,
      });
      retrievedChunks = r.chunks;
      status = null;
      answer = null;
      citations = [];
      latencyMs = r.latencyMs;
      estimatedCost = r.usage.estimatedCost;
      model = null;
      errorNote = r.error ?? null;
    } else {
      const result = await this.pipeline.query({
        query: c.question,
        topK: ctx.topK,
        rerank: ctx.rerank,
        strict: ctx.strict,
      });
      retrievedChunks = result.retrieval.chunks;
      status = result.status;
      answer = result.answer;
      citations = result.citations;
      latencyMs = result.latencyMs;
      estimatedCost = result.usage.estimatedCost;
      model = result.model;
      errorNote = result.error ?? null;
    }

    // Retrieval: ánh xạ documentId đã truy hồi → source (đơn vị đánh giá của
    // golden set). Tài liệu chưa COMPLETED không nằm trong map -> bị bỏ.
    const retrievedSources = retrievedChunks
      .map((ch) => ctx.docIdToSource.get(ch.documentId))
      .filter((s): s is string => !!s);

    const expected = c.expectedDocuments;
    const retrieval = {
      recallAtK: recallAtK(retrievedSources, expected, K),
      precisionAtK: precisionAtK(retrievedSources, expected, K),
      mrr: mrr(retrievedSources, expected),
      ndcgAtK: ndcgAtK(retrievedSources, expected, K),
      contextPrecision: contextPrecision(retrievedSources, expected, K),
      contextRecall: contextRecall(retrievedSources, expected),
    };
    const retrievedAllExpected =
      expected.length > 0 &&
      expected.every((s) => retrievedSources.includes(s));

    const abstained = status === null ? null : isAbstained(status);
    const absCorrect =
      status === null ? null : abstentionCorrect(c.answerable, status);

    let answerCorrectness: number | null = null;
    let citationAcc: number | null = null;

    if (!retrievalOnly) {
      const j = await this.judge.judge(c.question, c.expectedAnswer, answer);
      answerCorrectness = j?.score ?? null;

      const goldDocIds = expected
        .map((s) => ctx.sourceToDocId.get(s))
        .filter((id): id is string => !!id);
      citationAcc = citationAccuracy(
        citations.map((ct) => ({ documentId: ct.documentId })),
        goldDocIds,
      );
    }

    const failureLayer = retrievalOnly
      ? expected.length > 0 && !retrievedAllExpected
        ? 'RETRIEVAL_FAILURE'
        : undefined
      : this.classifyFailure({
          answerable: c.answerable,
          retrievedAllExpected,
          abstained: abstained ?? false,
          status: status as AnswerStatus,
          answerCorrectness,
          citationAcc,
        });
    const passed = retrievalOnly
      ? !failureLayer
      : this.decidePass({
          answerable: c.answerable,
          absCorrect: absCorrect ?? false,
          failureLayer,
          answerCorrectness,
        });

    const metrics = {
      ...retrieval,
      abstained,
      abstentionCorrect: absCorrect,
      answerCorrectness,
      citationAccuracy: citationAcc,
      latencyMs,
      estimatedCost,
    } as Prisma.InputJsonValue;

    const row = {
      passed,
      actualAnswer: answer,
      actualStatus: status,
      metrics,
      failureLayer: failureLayer ?? null,
      notes: errorNote,
    };
    await this.prisma.evaluationResult.upsert({
      where: { runId_caseId: { runId: ctx.runId, caseId: caseRow.id } },
      create: { runId: ctx.runId, caseId: caseRow.id, ...row },
      update: row,
    });

    return {
      answerable: c.answerable,
      hasExpectedDocs: expected.length > 0,
      status,
      retrieval,
      abstained,
      abstentionCorrect: absCorrect,
      answerCorrectness,
      citationAccuracy: citationAcc,
      latencyMs,
      estimatedCost,
      model,
      failureLayer,
      passed,
    };
  }

  // --- phân loại tầng lỗi (PROMPT §28) --------------------------------

  private classifyFailure(args: {
    answerable: boolean;
    retrievedAllExpected: boolean;
    abstained: boolean;
    status: AnswerStatus;
    answerCorrectness: number | null;
    citationAcc: number | null;
  }): HallucinationRootCause | undefined {
    if (args.status === 'ERROR') return 'RETRIEVAL_FAILURE';

    if (!args.answerable) {
      // Unanswerable: chỉ đạt khi abstain; nếu vẫn trả lời -> bịa.
      return args.abstained ? undefined : 'GENERATION_HALLUCINATION';
    }

    if (!args.retrievedAllExpected) return 'RETRIEVAL_FAILURE';
    if (args.abstained) return 'MISSING_CONTEXT'; // có evidence mà vẫn từ chối
    if (args.answerCorrectness !== null && args.answerCorrectness < 0.3) {
      return 'GENERATION_HALLUCINATION';
    }
    if (args.citationAcc !== null && args.citationAcc < 0.5) {
      return 'CITATION_HALLUCINATION';
    }
    return undefined;
  }

  private decidePass(args: {
    answerable: boolean;
    absCorrect: boolean;
    failureLayer: HallucinationRootCause | undefined;
    answerCorrectness: number | null;
  }): boolean {
    if (!args.absCorrect) return false;
    if (args.failureLayer) return false;
    if (
      args.answerable &&
      args.answerCorrectness !== null &&
      args.answerCorrectness < 0.5
    ) {
      return false;
    }
    return true;
  }

  // --- tổng hợp -------------------------------------------------------

  private aggregate(
    outcomes: PerCase[],
    cases: EvalCase[],
  ): Record<string, number | null> {
    const answerable = outcomes.filter((o) => o.answerable);
    // Số liệu retrieval chỉ có nghĩa trên case CÓ tài liệu gold — case
    // unanswerable (`expectedDocuments = []`) sẽ làm méo trung bình (recall→1,
    // precision→0…) nên loại khỏi mẫu (giống cách làm với answerCorrectness).
    const withGold = outcomes.filter((o) => o.hasExpectedDocs);
    // Case có chạy generation (mode='full'): status khác null.
    const generated = outcomes.filter(
      (o): o is PerCase & { status: AnswerStatus } => o.status !== null,
    );
    const caseOutcomes: CaseOutcome[] = generated.map((o) => ({
      answerable: o.answerable,
      status: o.status,
      answerCorrectness: o.answerCorrectness,
    }));

    const retrMean = (
      pick: (r: PerCase['retrieval']) => number,
    ): number | null =>
      withGold.length ? mean(withGold.map((o) => pick(o.retrieval))) : null;

    return {
      cases: outcomes.length,
      datasetSize: cases.length,
      unanswerableCount: outcomes.length - answerable.length,
      retrievalEvaluated: withGold.length,
      passRate: meanBool(outcomes.map((o) => o.passed)),
      recallAt5: retrMean((r) => r.recallAtK),
      precisionAt5: retrMean((r) => r.precisionAtK),
      mrr: retrMean((r) => r.mrr),
      ndcgAt5: retrMean((r) => r.ndcgAtK),
      contextPrecision: retrMean((r) => r.contextPrecision),
      contextRecall: retrMean((r) => r.contextRecall),
      abstentionAccuracy: generated.length
        ? meanBool(
            generated
              .map((o) => o.abstentionCorrect)
              .filter((v): v is boolean => v !== null),
          )
        : null,
      answerCorrectness: meanIgnoringNull(
        answerable.map((o) => o.answerCorrectness),
      ),
      citationAccuracy: meanIgnoringNull(
        outcomes.map((o) => o.citationAccuracy),
      ),
      hallucinationRateProxy: generated.length
        ? hallucinationRateProxy(caseOutcomes)
        : null,
      avgLatencyMs: Math.round(mean(outcomes.map((o) => o.latencyMs)) || 0),
      totalCost: round(outcomes.reduce((s, o) => s + o.estimatedCost, 0)),
    };
  }
}

interface PerCase {
  answerable: boolean;
  hasExpectedDocs: boolean;
  /** null ở mode='retrieval' (không gọi LLM sinh câu trả lời). */
  status: AnswerStatus | null;
  retrieval: {
    recallAtK: number;
    precisionAtK: number;
    mrr: number;
    ndcgAtK: number;
    contextPrecision: number;
    contextRecall: number;
  };
  abstained: boolean | null;
  abstentionCorrect: boolean | null;
  answerCorrectness: number | null;
  citationAccuracy: number | null;
  latencyMs: number;
  estimatedCost: number;
  model: string | null;
  failureLayer: HallucinationRootCause | undefined;
  passed: boolean;
}

function invert(m: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of m) out.set(v, k);
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19);
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
