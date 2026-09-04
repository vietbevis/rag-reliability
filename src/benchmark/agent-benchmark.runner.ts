import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { LlmService } from '../ai/llm/llm.service';
import { AgentGraphBuilder } from '../agent/graph/agent-graph.builder';
import { AnswerVerificationService } from '../rag/grounding/answer-verification.service';
import { AnswerJudgeService } from '../evaluation/metrics/answer-judge.service';
import {
  evaluateTrajectory,
  type EvaluatorResult,
} from '../evaluation/agent/evaluators';
import { toTrajectoryView } from '../evaluation/agent/trajectory-view';
import {
  defaultEvaluators,
  type AgentBenchmarkCase,
} from './agent-case.schema';
import { buildCaseRegistry } from './mock/build-case-registry';

export interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  score: number;
  failedHard: string[];
  failureClass: string | null;
  stopReason: string;
  finalStatus: string | null;
  toolsRequested: string[];
  stepCount: number;
  toolCallCount: number;
  latencyMs: number;
  tokens: number;
  evaluators: EvaluatorResult[];
  error?: string;
}

export interface BenchmarkReport {
  createdAt: string;
  provider: string;
  model: string;
  caseCount: number;
  metrics: {
    taskSuccess: number;
    avgScore: number;
    toolSelectionAccuracy: number;
    argumentAccuracy: number;
    groundedness: number;
    citationAccuracy: number;
    hallucinationRate: number;
    recoveryRate: number;
    safetyRate: number;
    avgSteps: number;
    avgToolCalls: number;
    avgLatencyMs: number;
    totalTokens: number;
  };
  byCategory: Record<
    string,
    { count: number; passRate: number; avgScore: number }
  >;
  byFailureClass: Record<string, number>;
  cases: CaseResult[];
}

/**
 * Chạy dataset benchmark agent (PROMPT §26). Mỗi case: dựng ToolRegistry mock
 * tất định → AgentGraphBuilder mới → chạy → TrajectoryView → evaluator →
 * điểm. KHÔNG persist (deterministic); report ra JSON cho baseline/diff.
 */
@Injectable()
export class AgentBenchmarkRunner {
  private readonly logger = new Logger(AgentBenchmarkRunner.name);

  constructor(
    private readonly llm: LlmService,
    private readonly verification: AnswerVerificationService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly judge: AnswerJudgeService,
  ) {}

  async run(cases: AgentBenchmarkCase[]): Promise<BenchmarkReport> {
    const results: CaseResult[] = [];

    for (const c of cases) {
      this.logger.log(`[${c.category}] ${c.id}: "${c.input.slice(0, 60)}"`);
      results.push(await this.runCase(c));
    }

    return this.aggregate(results);
  }

  private async runCase(c: AgentBenchmarkCase): Promise<CaseResult> {
    const registry = await buildCaseRegistry(c);
    const builder = new AgentGraphBuilder(
      this.llm,
      registry,
      this.verification,
      this.config,
    );

    try {
      const outcome = await builder.run(c.input, {
        toolAllowlist: c.toolAllowlist,
      });
      const view = toTrajectoryView(outcome);

      let answerCorrectness: number | null = null;
      if (c.expectation.expectedAnswer && this.judge.isAvailable()) {
        answerCorrectness =
          (
            await this.judge.judge(
              c.input,
              c.expectation.expectedAnswer,
              view.answer,
            )
          )?.score ?? null;
      }

      const only = c.evaluators ?? defaultEvaluators(c.category);
      const scored = evaluateTrajectory(
        { view, expectation: c.expectation, answerCorrectness },
        only,
      );

      return {
        id: c.id,
        category: c.category,
        pass: scored.pass,
        score: round(scored.score),
        failedHard: scored.failedHard,
        failureClass: view.failureClass,
        stopReason: view.stopReason,
        finalStatus: view.finalStatus,
        toolsRequested: view.toolsRequested,
        stepCount: view.stepCount,
        toolCallCount: view.toolCallCount,
        latencyMs: view.latencyMs,
        tokens: view.usage.inputTokens + view.usage.outputTokens,
        evaluators: scored.results,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`case ${c.id} lỗi: ${message}`);
      return {
        id: c.id,
        category: c.category,
        pass: false,
        score: 0,
        failedHard: ['runtime'],
        failureClass: 'UNKNOWN_ERROR',
        stopReason: 'error',
        finalStatus: null,
        toolsRequested: [],
        stepCount: 0,
        toolCallCount: 0,
        latencyMs: 0,
        tokens: 0,
        evaluators: [],
        error: message,
      };
    }
  }

  private aggregate(cases: CaseResult[]): BenchmarkReport {
    const n = cases.length || 1;
    const evalMean = (name: string): number => {
      const xs = cases
        .flatMap((c) => c.evaluators)
        .filter((e) => e.name === name && e.pass !== null);
      return xs.length ? mean(xs.map((e) => e.score)) : 0;
    };

    const byCategory: BenchmarkReport['byCategory'] = {};
    for (const c of cases) {
      const g = (byCategory[c.category] ??= {
        count: 0,
        passRate: 0,
        avgScore: 0,
      });
      g.count++;
    }
    for (const cat of Object.keys(byCategory)) {
      const cs = cases.filter((c) => c.category === cat);
      byCategory[cat]!.passRate = round(
        cs.filter((c) => c.pass).length / cs.length,
      );
      byCategory[cat]!.avgScore = round(mean(cs.map((c) => c.score)));
    }

    const byFailureClass: Record<string, number> = {};
    for (const c of cases) {
      if (c.failureClass) {
        byFailureClass[c.failureClass] =
          (byFailureClass[c.failureClass] ?? 0) + 1;
      }
    }

    return {
      createdAt: new Date().toISOString(),
      provider: this.llm.activeProvider,
      model: this.llm.activeModel,
      caseCount: cases.length,
      metrics: {
        taskSuccess: round(cases.filter((c) => c.pass).length / n),
        avgScore: round(mean(cases.map((c) => c.score))),
        toolSelectionAccuracy: round(evalMean('toolSelection')),
        argumentAccuracy: round(evalMean('toolArgument')),
        groundedness: round(evalMean('groundedness')),
        citationAccuracy: round(evalMean('citation')),
        hallucinationRate: round(evalMean('hallucination')),
        recoveryRate: round(evalMean('recovery')),
        safetyRate: round(evalMean('safety')),
        avgSteps: round(mean(cases.map((c) => c.stepCount))),
        avgToolCalls: round(mean(cases.map((c) => c.toolCallCount))),
        avgLatencyMs: Math.round(mean(cases.map((c) => c.latencyMs))),
        totalTokens: cases.reduce((s, c) => s + c.tokens, 0),
      },
      byCategory,
      byFailureClass,
      cases,
    };
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
