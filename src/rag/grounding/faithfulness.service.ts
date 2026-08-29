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

    // 3. Kiểm tra mâu thuẫn chéo giữa các chunk trong ngữ cảnh (PROMPT §26).
    //    Ở chế độ 'auto'/'llm', đây chỉ là ỨNG VIÊN — heuristic số liệu dễ báo
    //    nhầm khi corpus có nhiều điều khoản chứa số (vd GPA 2,0/2,5/3,2 ở các
    //    điều khác nhau). `CONFLICTING_EVIDENCE` cuối cùng do NLI quyết
    //    (`contradictedCount`), không do heuristic này. Chỉ 'heuristic' thuần
    //    mới tin nó một mình.
    const contextConflictCandidate = detectContextMutualContradiction(chunks);
    const contextConflictAuthoritative =
      mode === 'heuristic' && contextConflictCandidate.hasConflict;

    // 4. Khởi tạo map evidence theo claim
    const evMap = new Map(evidence.map((e) => [e.claimId, { ...e }]));

    let methodUsed: 'heuristic' | 'llm' = 'heuristic';
    let tokenUsage = emptyUsage;

    const chunkById = new Map(chunks.map((c) => [c.chunkId, c]));

    // 5. Kiểm tra mâu thuẫn từ vựng/số liệu/phủ định (Heuristic Check).
    //
    //    QUAN TRỌNG (docs/audit/FAITHFULNESS_REVIEW.md §3 [P0]): CHỈ đối chiếu
    //    claim với chunk bằng chứng ĐÃ KHỚP của chính nó (`evidenceChunkIds`),
    //    KHÔNG quét toàn bộ context. Quét toàn bộ khiến một quy chế có điều
    //    khoản cấm ("không được dự thi") đánh sập mọi câu trả lời khẳng định
    //    hợp lệ thành CONFLICTING_EVIDENCE.
    //
    //    Ở chế độ 'auto'/'llm', mâu thuẫn heuristic chỉ là ỨNG VIÊN — phải được
    //    NLI LLM xác nhận (bước 6) mới thành verdict cuối. Chỉ chế độ 'heuristic'
    //    thuần mới tin tưởng verdict heuristic một mình.
    const heuristicContradictedIds = new Set<string>();
    for (const claim of claims) {
      const currentEv = evMap.get(claim.id);
      if (!currentEv || currentEv.evidenceChunkIds.length === 0) continue;

      for (const chunkId of currentEv.evidenceChunkIds) {
        const chunk = chunkById.get(chunkId);
        if (!chunk) continue;
        const contra = detectClaimChunkContradiction(claim.text, chunk.content);
        if (contra.contradicts) {
          heuristicContradictedIds.add(claim.id);
          if (mode === 'heuristic') {
            currentEv.verdict = 'CONTRADICTED';
            currentEv.supported = false;
          }
          break;
        }
      }
    }

    // 6. Gọi NLI LLM khi chế độ 'llm', hoặc 'auto' + có claim chưa chắc chắn
    //    (UNSUPPORTED, thiếu evidence, hoặc heuristic nghi mâu thuẫn).
    const hasAmbiguousClaim = claims.some((c) => {
      const ev = evMap.get(c.id);
      return (
        !ev ||
        ev.verdict === 'UNSUPPORTED' ||
        heuristicContradictedIds.has(c.id)
      );
    });

    if (
      (mode === 'llm' || (mode === 'auto' && hasAmbiguousClaim)) &&
      chunks.length > 0
    ) {
      try {
        const contextStr = chunks
          .map((c, i) => `[${i + 1}] (chunk: ${c.chunkId}):\n${c.content}`)
          .join('\n\n');
        const claimsStr = claims
          .map((c) => `- [${c.id}]: ${c.text}`)
          .join('\n');

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
        this.logger.warn(
          `LLM NLI verification lỗi, fallback về heuristic: ${(err as Error).message}`,
        );
        // Fallback: LLM là bên xác nhận mâu thuẫn nhưng không dùng được → áp
        // verdict heuristic để không bỏ sót mâu thuẫn thật (đánh đổi: có thể
        // dương tính giả khi LLM down, nhưng đã thu hẹp về evidence chunk).
        for (const id of heuristicContradictedIds) {
          const ev = evMap.get(id);
          if (ev) {
            ev.verdict = 'CONTRADICTED';
            ev.supported = false;
          }
        }
      }
    } else if (mode === 'auto' && heuristicContradictedIds.size > 0) {
      // Có nghi vấn mâu thuẫn heuristic nhưng không đủ điều kiện gọi LLM
      // (không có chunk) — ghi log, KHÔNG tự ý hạ verdict.
      this.logger.debug(
        `Bỏ qua ${heuristicContradictedIds.size} nghi vấn mâu thuẫn heuristic (không có ngữ cảnh để NLI xác nhận)`,
      );
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
    const supportedCount = verifiedEvidenceList.filter(
      (e) => e.verdict === 'SUPPORTED',
    ).length;
    const contradictedCount = verifiedEvidenceList.filter(
      (e) => e.verdict === 'CONTRADICTED',
    ).length;

    // Phạt điểm: nếu có mâu thuẫn thì điểm giảm sâu
    const rawScore =
      totalClaims > 0
        ? (supportedCount - contradictedCount * 2) / totalClaims
        : 0;
    const score = Math.max(
      0,
      Math.min(1, Math.round(rawScore * 10000) / 10000),
    );
    const grounded =
      score >= threshold &&
      contradictedCount === 0 &&
      !contextConflictAuthoritative;

    // 9. Xác định Root Cause (PROMPT §28) nếu ungrounded.
    //    Chỉ gán CONFLICTING_CONTEXT khi mâu thuẫn context được xác nhận: chế độ
    //    heuristic thuần, HOẶC NLI đã đánh dấu có claim CONTRADICTED (khi đó ứng
    //    viên heuristic được coi là thật).
    const contextConflictConfirmed =
      contextConflictAuthoritative ||
      (contextConflictCandidate.hasConflict && contradictedCount > 0);
    let rootCause: HallucinationRootCause | undefined;
    if (!grounded) {
      rootCause = this.classifyRootCause({
        chunks,
        contextConflict: contextConflictConfirmed,
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
      args.chunks.reduce((sum, c) => sum + (c.score || 0), 0) /
      args.chunks.length;
    if (avgChunkScore < 0.3) {
      return 'IRRELEVANT_CONTEXT';
    }

    if (
      args.contradictedCount > 0 ||
      args.supportedCount < args.totalClaims * 0.5
    ) {
      return 'GENERATION_HALLUCINATION';
    }

    return 'MISSING_CONTEXT';
  }
}
