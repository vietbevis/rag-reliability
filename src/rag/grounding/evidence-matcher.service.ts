import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type {
  Claim,
  Evidence,
  RetrievedChunk,
} from '../../common/types/pipeline.contracts';
import { contentTokens } from './grounding-checks';

export interface EvidenceMatchOptions {
  /** Ngưỡng overlap tối thiểu để coi là supported (mặc định từ config citation.minOverlap). */
  minOverlap?: number;
  /** Số lượng chunk bằng chứng tối đa cho mỗi claim (mặc định từ config citation.maxPerClaim). */
  maxPerClaim?: number;
  /** Danh sách chunkId mà generation LLM khai đã trích dẫn (prior). */
  usedContextChunkIds?: string[];
}

export interface MatchClaimResult {
  supported: boolean;
  evidenceChunkIds: string[];
  score: number;
}

/**
 * Hàm thuần so khớp một claimText với danh sách chunk ngữ cảnh dựa trên token overlap (claim-recall).
 */
export function matchClaimToChunks(
  claimText: string,
  chunks: readonly { chunkId: string; content: string }[],
  cfg: {
    minOverlap: number;
    maxPerClaim: number;
    usedContextChunkIds?: Set<string>;
  },
): MatchClaimResult {
  const claimToks = contentTokens(claimText);
  if (claimToks.size === 0) {
    return {
      supported: false,
      evidenceChunkIds: [],
      score: 0,
    };
  }

  let best = 0;
  interface Candidate {
    chunkId: string;
    overlap: number;
    index: number;
  }

  const evaluatedChunks: Candidate[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const chunkToks = contentTokens(chunk.content);

    let intersectionCount = 0;
    for (const token of claimToks) {
      if (chunkToks.has(token)) {
        intersectionCount++;
      }
    }

    const rawOverlap = intersectionCount / claimToks.size;
    const overlap = Math.round(rawOverlap * 10000) / 10000;

    if (overlap > best) {
      best = overlap;
    }

    const isUsed = cfg.usedContextChunkIds?.has(chunk.chunkId) ?? false;
    const isDirectMatch = overlap >= cfg.minOverlap;
    const isUsedMatch = isUsed && overlap >= cfg.minOverlap * 0.6;

    if (isDirectMatch || isUsedMatch) {
      evaluatedChunks.push({
        chunkId: chunk.chunkId,
        overlap,
        index,
      });
    }
  }

  const supported = best >= cfg.minOverlap;
  if (!supported) {
    return {
      supported: false,
      evidenceChunkIds: [],
      score: best,
    };
  }

  // Sắp xếp các chunk đủ điều kiện theo overlap giảm dần; tie-break giữ thứ tự ban đầu
  evaluatedChunks.sort((a, b) => {
    if (b.overlap !== a.overlap) {
      return b.overlap - a.overlap;
    }
    return a.index - b.index;
  });

  const selectedChunkIds = evaluatedChunks
    .slice(0, cfg.maxPerClaim)
    .map((c) => c.chunkId);

  return {
    supported: true,
    evidenceChunkIds: selectedChunkIds,
    score: best,
  };
}

/**
 * Service ánh xạ claim → evidence chunk dựa trên so khớp từ vựng (deterministic, không gọi LLM).
 */
@Injectable()
export class EvidenceMatcherService {
  private readonly minOverlap: number;
  private readonly maxPerClaim: number;

  constructor(config: ConfigService<AppConfig, true>) {
    try {
      const c = config.get('citation', { infer: true }) as
        { minOverlap: number; maxPerClaim: number } | undefined;
      this.minOverlap = c?.minOverlap ?? 0.5;
      this.maxPerClaim = c?.maxPerClaim ?? 3;
    } catch {
      this.minOverlap = 0.5;
      this.maxPerClaim = 3;
    }
  }

  /**
   * Khớp danh sách claims với các chunk ngữ cảnh và trả về danh sách Evidence tương ứng.
   */
  match(
    claims: readonly Claim[],
    chunks: readonly RetrievedChunk[],
    opts?: EvidenceMatchOptions,
  ): Evidence[] {
    const minOverlap = opts?.minOverlap ?? this.minOverlap;
    const maxPerClaim = opts?.maxPerClaim ?? this.maxPerClaim;
    const usedContextChunkIds = opts?.usedContextChunkIds
      ? new Set(opts.usedContextChunkIds)
      : undefined;

    return claims.map((claim) => {
      const result = matchClaimToChunks(claim.text, chunks, {
        minOverlap,
        maxPerClaim,
        usedContextChunkIds,
      });

      return {
        claimId: claim.id,
        supported: result.supported,
        evidenceChunkIds: result.evidenceChunkIds,
        verdict: result.supported ? 'SUPPORTED' : 'UNSUPPORTED',
        score: result.score,
      };
    });
  }
}
