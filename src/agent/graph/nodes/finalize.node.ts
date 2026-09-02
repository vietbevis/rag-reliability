import type { Logger } from '@nestjs/common';
import type { Citation, RetrievedChunk } from '../../../common/types';
import type {
  AnswerVerificationService,
  VerificationResult,
} from '../../../rag/grounding/answer-verification.service';
import type { ToolEvidence } from '../../tools/tool.interface';
import type {
  AgentCitation,
  AgentState,
  AgentStateUpdate,
} from '../agent-state';

export interface FinalizeNodeDeps {
  verification: Pick<
    AnswerVerificationService,
    'verifyAnswer' | 'synthesizeAndVerify'
  >;
  logger: Logger;
}

const COMPUTATION_DOC_ID = 'computation';

/**
 * Node `finalize` (PHASE 17 §9). Ép câu trả lời cuối qua đường verify dùng
 * chung với RAG: claim → evidence → citation → faithfulness → map `RagStatus`.
 *
 * - Agent đã có câu trả lời (`stopReason='final'`) ⇒ verify chính câu đó.
 * - Agent dừng sớm mà chưa có câu trả lời ⇒ tổng hợp từ evidence đã gom, hoặc
 *   abstain nếu không có evidence nào.
 *
 * Evidence `kind:'computation'` (calculator…) được đưa vào như "chunk" giả để
 * claim về số liệu tính được vẫn có căn cứ; citation của chúng gắn
 * `kind:'computation'`.
 */
export function createFinalizeNode(deps: FinalizeNodeDeps) {
  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const kbChunks = evidenceToChunks(state.evidence);
    const computeChunks = computationToChunks(state.evidence);
    const allChunks = [...kbChunks, ...computeChunks];
    const base = state.steps.length;

    let result: VerificationResult;
    if (state.answer === null) {
      deps.logger.debug(
        `finalize: dừng sớm (${state.stopReason ?? '?'}) — tổng hợp từ ${allChunks.length} evidence`,
      );
      result = await deps.verification.synthesizeAndVerify(
        state.task,
        allChunks,
      );
    } else {
      result = await deps.verification.verifyAnswer(state.answer, allChunks);
    }

    const citations = toAgentCitations(result.citations, state.evidence);

    deps.logger.log(
      `finalize: status=${result.status} · ${citations.length} citation · ${result.claims.length} claim`,
    );

    return {
      answer: result.answer,
      finalStatus: result.status,
      citations,
      verifiedClaims: result.claims,
      faithfulness: result.faithfulness,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCost: result.usage.estimatedCost,
      },
      steps: [
        {
          index: base,
          type: 'FINAL',
          note: `status=${result.status}`,
          latencyMs: undefined,
        },
      ],
    };
  };
}

/** Evidence chunk/graph → RetrievedChunk (dedupe theo chunkId). */
export function evidenceToChunks(evidence: ToolEvidence[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const e of evidence) {
    if (e.kind === 'computation') continue;
    const chunkId = e.chunkId ?? e.ref;
    if (seen.has(chunkId)) continue;
    seen.add(chunkId);
    out.push({
      chunkId,
      documentId: e.documentId ?? 'unknown',
      content: e.text,
      score: e.score ?? 0.5,
      source: e.kind === 'graph' ? 'graph' : 'vector',
      heading: e.heading,
      section: e.section,
      page: e.page,
      metadata: {},
    });
  }
  return out;
}

/** Evidence computation → chunk giả để verify claim số liệu. */
export function computationToChunks(
  evidence: ToolEvidence[],
): RetrievedChunk[] {
  return evidence
    .filter((e) => e.kind === 'computation')
    .map((e, i) => ({
      chunkId: `compute:${i + 1}`,
      documentId: COMPUTATION_DOC_ID,
      content: e.text,
      score: 1,
      source: 'vector' as const,
      metadata: {},
    }));
}

function toAgentCitations(
  citations: Citation[],
  evidence: ToolEvidence[],
): AgentCitation[] {
  const graphChunkIds = new Set(
    evidence.filter((e) => e.kind === 'graph').map((e) => e.chunkId ?? e.ref),
  );
  return citations.map((c) => {
    const isComputation =
      c.documentId === COMPUTATION_DOC_ID || c.chunkId.startsWith('compute:');
    const kind: AgentCitation['kind'] = isComputation
      ? 'computation'
      : graphChunkIds.has(c.chunkId)
        ? 'graph'
        : 'chunk';
    return {
      claimId: c.claimId,
      claimText: c.claimText,
      kind,
      documentId:
        isComputation || c.documentId === 'unknown' ? undefined : c.documentId,
      chunkId: isComputation ? undefined : c.chunkId,
      section: c.section,
      page: c.page,
      valid: c.valid,
    };
  });
}
