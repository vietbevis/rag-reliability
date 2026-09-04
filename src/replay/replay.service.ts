import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../ai/llm/llm.service';
import { AgentGraphBuilder } from '../agent/graph/agent-graph.builder';
import { AnswerVerificationService } from '../rag/grounding/answer-verification.service';
import { ToolRegistryService } from '../tools/registry/tool-registry.service';
import {
  ReplayToolProvider,
  type RecordedStep,
  type ReplayMode,
} from './replay-tool.provider';

export interface ReplayDiff {
  runId: string;
  mode: ReplayMode;
  recorded: {
    answer: string | null;
    finalStatus: string | null;
    stopReason: string | null;
    toolsRequested: string[];
    stepCount: number;
  };
  replayed: {
    answer: string | null;
    finalStatus: string | null;
    stopReason: string;
    toolsRequested: string[];
    stepCount: number;
  };
  changed: {
    answer: boolean;
    finalStatus: boolean;
    toolPath: boolean;
    stepCount: boolean;
  };
  /** `true` khi replay có tool side-effecting bị chặn (không blind replay). */
  sideEffectsSkipped: string[];
}

/**
 * Replay một `AgentRun` đã ghi (PROMPT §36). Dùng để regression theo trace: chạy
 * lại quỹ đạo với code hiện tại và so sánh. Tool side-effecting KHÔNG bao giờ
 * bị blind replay.
 */
@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly llm: LlmService,
    private readonly verification: AnswerVerificationService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async replay(
    runId: string,
    mode: ReplayMode = 'recorded',
  ): Promise<ReplayDiff> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: { index: 'asc' } } },
    });
    if (!run) throw new NotFoundException(`AgentRun ${runId} không tồn tại`);

    const recordedSteps: RecordedStep[] = run.steps.map((s) => ({
      toolName: s.toolName,
      toolInput: s.toolInput,
      toolOutput: s.toolOutput,
      evidence: s.evidence,
      error: s.error,
    }));

    const sideEffectsSkipped = run.steps
      .filter((s) => {
        if (!s.toolName) return false;
        const t = this.registry.get(s.toolName.replace(/__/g, '.'));
        return t?.definition.metadata.sideEffect === 'side-effecting';
      })
      .map((s) => s.toolName as string);

    const replayProvider = new ReplayToolProvider(
      this.registry,
      recordedSteps,
      mode,
    );
    const replayRegistry = new ToolRegistryService([replayProvider]);
    await replayRegistry.bootstrap();

    const builder = new AgentGraphBuilder(
      this.llm,
      replayRegistry,
      this.verification,
      this.config,
    );
    const outcome = await builder.run(run.task, {
      agentRunId: `replay:${runId}`,
    });

    const recordedTools = run.steps
      .filter((s) => s.toolName && s.type === 'TOOL_CALL')
      .map((s) => (s.toolName as string).replace(/__/g, '.'));
    const replayedTools = outcome.steps
      .filter((s) => s.toolName && s.type === 'TOOL_CALL')
      .map((s) => (s.toolName as string).replace(/__/g, '.'));

    this.logger.log(
      `replay ${runId} (${mode}): recorded="${run.answer?.slice(0, 40)}" → replay="${outcome.answer?.slice(0, 40)}"`,
    );

    return {
      runId,
      mode,
      recorded: {
        answer: run.answer,
        finalStatus: run.finalStatus,
        stopReason: run.stopReason,
        toolsRequested: recordedTools,
        stepCount: run.stepCount,
      },
      replayed: {
        answer: outcome.answer,
        finalStatus: outcome.finalStatus,
        stopReason: outcome.stopReason,
        toolsRequested: replayedTools,
        stepCount: outcome.steps.length,
      },
      changed: {
        answer: (run.answer ?? '') !== (outcome.answer ?? ''),
        finalStatus: run.finalStatus !== outcome.finalStatus,
        toolPath:
          JSON.stringify(recordedTools) !== JSON.stringify(replayedTools),
        stepCount: run.stepCount !== outcome.steps.length,
      },
      sideEffectsSkipped,
    };
  }
}
