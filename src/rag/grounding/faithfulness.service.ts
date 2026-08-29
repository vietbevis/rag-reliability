import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../config/configuration';
import type {
  Claim,
  Evidence,
  FaithfulnessResult,
  HallucinationRootCause,
  RagStatus,
  RetrievedChunk,
  TokenUsage,
} from '../../common/types/pipeline.contracts';
import { LlmService } from '../../ai/llm/llm.service';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { looksLikeAbstention } from './grounding-checks';
import {
  detectClaimChunkContradiction,
  detectContextMutualContradiction,
} from './contradiction-detector';

export interface FaithfulnessVerifyOptions {
  verifierMode?: 'auto' | 'heuristic' | 'llm';
  threshold?: number;
}

export interface FaithfulnessExecutionResult {
  result: FaithfulnessResult;
  usage: TokenUsage;
  latencyMs: number;
  method: 'skipped' | 'heuristic' | 'llm';
}

const NLI_SCHEMA = z.object({
  verdicts: z.array(
    z.object({
      claimId: z.string(),
      verdict: z.enum(['SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED']),
      reason: z.string().optional(),
    }),
  ),
});

const NLI_SYSTEM_PROMPT = `Bạn là hệ thống kiểm chứng tính trung thực (Faithfulness & NLI Verifier) cho RAG.
Nhiệm vụ: Đối chiếu từng khẳng định (claim) của câu trả lời với các đoạn ngữ cảnh (context chunks).

Với mỗi claim, hãy gán một trong ba nhãn:
1. SUPPORTED: Khẳng định được suy ra trực tiếp hoặc chứng minh đầy đủ bởi ít nhất một đoạn ngữ cảnh.
2. UNSUPPORTED: Ngữ cảnh không nhắc tới hoặc không đủ thông tin để xác nhận (hallucination).
3. CONTRADICTED: Khẳng định mâu thuẫn, trái ngược hoặc sai lệch số liệu/phủ định so với ngữ cảnh.

Trả về JSON:
{
  "verdicts": [
    { "claimId": "c1", "verdict": "SUPPORTED", "reason": "..." }
  ]
}`;

/**
 * Service đánh giá độ trung thực (Faithfulness) và phát hiện mâu thuẫn (PROMPT §26, §27, §28).
 */
@Injectable()
export class FaithfulnessService {
  private readonly logger = new Logger(FaithfulnessService.name);
  private readonly defaultMode: 'auto' | 'heuristic' | 'llm';
  private readonly defaultThreshold: number;
  private readonly temperature: number;

  constructor(
    private readonly llm: LlmService,
    config: ConfigService<AppConfig, true>,
  ) {
    const faithCfg = config.get('faithfulness', { infer: true });
    this.defaultMode = faithCfg?.verifierMode ?? 'auto';
    this.defaultThreshold = faithCfg?.threshold ?? 0.8;
    this.temperature = config.get('rag', { infer: true })?.temperature ?? 0;
  }

  async verify(
    answer: string,
    claims: readonly Claim[],
    evidence: readonly Evidence[],
    chunks: readonly RetrievedChunk[],
    status: RagStatus,
    opts: FaithfulnessVerifyOptions = {},
  ): Promise<FaithfulnessExecutionResult> {
    const started = Date.now();
    const threshold = opts.threshold ?? this.defaultThreshold;
    const mode = opts.verifierMode ?? this.defaultMode;

    const emptyUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };

    const trimmed = answer.trim();

    // 1. Trường hợp từ chối (Abstention) -> trung thực 100%
    if (
      status === 'INSUFFICIENT_EVIDENCE' ||
      trimmed.length === 0 ||
      looksLikeAbstention(trimmed)
    ) {
      return {
        result: {
          score: 1.0,
          grounded: true,
          claims: [],
        },
        usage: emptyUsage,
        latencyMs: Date.now() - started,
        method: 'skipped',
      };
    }

    // 2. Nếu câu trả lời có nội dung nhưng không có claim nào
    if (claims.length === 0) {
      return {
        result: {
          score: 0,
          grounded: false,
          claims: [],
          rootCause: 'GENERATION_HALLUCINATION',
        },
        usage: emptyUsage,
        latencyMs: Date.now() - started,
        method: 'heuristic',
      };
    }

    // 3. Kiểm tra mâu thuẫn chéo giữa các chunk trong ngữ cảnh (PROMPT §26)
    const contextConflict = detectContextMutualContradiction(chunks);

    // 4. Khởi tạo map evidence theo claim
    const evMap = new Map(evidence.map((e) => [e.claimId, { ...e }]));

    let methodUsed: 'heuristic' | 'llm' = 'heuristic';
    let tokenUsage = emptyUsage;

    // 5. Kiểm tra mâu thuẫn từ vựng/số liệu/phủ định (Heuristic Check)
    for (const claim of claims) {
      const currentEv = evMap.get(claim.id);
      if (!currentEv) continue;

      for (const chunk of chunks) {
        const contra = detectClaimChunkContradiction(claim.text, chunk.content);
        if (contra.contradicts) {
          currentEv.verdict = 'CONTRADICTED';
          currentEv.supported = false;
          break;
        }
      }
    }

    // 6. Nếu chế độ 'llm' hoặc 'auto' (khi có claim không chắc chắn / unsupported), gọi NLI LLM
    const hasAmbiguousClaim = claims.some((c) => {
      const ev = evMap.get(c.id);
      return !ev || ev.verdict === 'UNSUPPORTED';
    });

    if ((mode === 'llm' || (mode === 'auto' && hasAmbiguousClaim)) && chunks.length > 0) {
      try {
        const contextStr = chunks
          .map((c, i) => `[${i + 1}] (chunk: ${c.chunkId}):\n${c.content}`)
          .join('\n\n');
        const claimsStr = claims.map((c) => `- [${c.id}]: ${c.text}`).join('\n');

        const messages: ChatMessage[] = [
          { role: 'system', content: NLI_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `NGỮ CẢNH:\n${contextStr}\n\nDANH SÁCH KHẲNG ĐỊNH:\n${claimsStr}`,
          },
        ];

        const res = await this.llm.chatStructured(messages, NLI_SCHEMA, {
          temperature: this.temperature,
          traceLabel: 'rag.faithfulness.nli-verify',
        });

        tokenUsage = res.usage;
        methodUsed = 'llm';

        for (const item of res.data.verdicts) {
          const ev = evMap.get(item.claimId);
          if (ev) {
            ev.verdict = item.verdict;
            ev.supported = item.verdict === 'SUPPORTED';
          }
        }
      } catch (err) {
        this.logger.warn(`LLM NLI verification lỗi, fallback về heuristic: ${(err as Error).message}`);
      }
    }

    // 7. Tổng hợp danh sách Evidence kết quả
    const verifiedEvidenceList: Evidence[] = claims.map((c) => {
      const ev = evMap.get(c.id);
      return (
        ev ?? {
          claimId: c.id,
          supported: false,
          evidenceChunkIds: [],
          verdict: 'UNSUPPORTED',
          score: 0,
        }
      );
    });

    // 8. Tính điểm Faithfulness Score
    const totalClaims = verifiedEvidenceList.length;
    const supportedCount = verifiedEvidenceList.filter((e) => e.verdict === 'SUPPORTED').length;
    const contradictedCount = verifiedEvidenceList.filter((e) => e.verdict === 'CONTRADICTED').length;

    // Phạt điểm: nếu có mâu thuẫn thì điểm giảm sâu
    const rawScore = totalClaims > 0 ? (supportedCount - contradictedCount * 2) / totalClaims : 0;
    const score = Math.max(0, Math.min(1, Math.round(rawScore * 10000) / 10000));
    const grounded = score >= threshold && contradictedCount === 0 && !contextConflict.hasConflict;

    // 9. Xác định Root Cause (PROMPT §28) nếu ungrounded
    let rootCause: HallucinationRootCause | undefined;
    if (!grounded) {
      rootCause = this.classifyRootCause({
        chunks,
        contextConflict: contextConflict.hasConflict,
        contradictedCount,
        supportedCount,
        totalClaims,
      });
    }

    return {
      result: {
        score,
        grounded,
        claims: verifiedEvidenceList,
        rootCause,
      },
      usage: tokenUsage,
      latencyMs: Date.now() - started,
      method: methodUsed,
    };
  }

  /**
   * Phân loại nguyên nhân gốc của hallucination theo 7 tầng phân cấp (PROMPT §28).
   */
  private classifyRootCause(args: {
    chunks: readonly RetrievedChunk[];
    contextConflict: boolean;
    contradictedCount: number;
    supportedCount: number;
    totalClaims: number;
  }): HallucinationRootCause {
    if (args.chunks.length === 0) {
      return 'RETRIEVAL_FAILURE';
    }

    if (args.contextConflict) {
      return 'CONFLICTING_CONTEXT';
    }

    const avgChunkScore =
      args.chunks.reduce((sum, c) => sum + (c.score || 0), 0) / args.chunks.length;
    if (avgChunkScore < 0.3) {
      return 'IRRELEVANT_CONTEXT';
    }

    if (args.contradictedCount > 0 || args.supportedCount < args.totalClaims * 0.5) {
      return 'GENERATION_HALLUCINATION';
    }

    return 'MISSING_CONTEXT';
  }
}
