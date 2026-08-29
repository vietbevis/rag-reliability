import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type {
  Citation,
  Claim,
  Evidence,
  RetrievedChunk,
} from '../../common/types';
import { Neo4jService } from '../../graph/neo4j.service';
import { properNouns } from '../../common/utils/text.util';

export interface CitationBuildOptions {
  /** Cho phép thử map claim quan hệ → cạnh RELATED (mặc định theo config). */
  relationshipCitations?: boolean;
}

export interface CitationBuildResult {
  citations: Citation[];
  stats: {
    chunkCitations: number;
    relationshipCitations: number;
    invalidClaims: number;
    relationshipLookups: number;
  };
}

/** Tối đa số claim thử tra Neo4j (mỗi claim 1 query) — chặn bùng nổ chi phí. */
const MAX_RELATIONSHIP_LOOKUPS = 12;

/**
 * Sinh citation do BACKEND quản lý (PROMPT §29): claim → evidence → chunk →
 * document/page/section. KHÔNG tin citation id do LLM tạo. Claim không map được
 * evidence nào → một bản ghi `valid: false` (không bịa, nhưng ghi nhận claim
 * thiếu căn cứ).
 *
 * Mở rộng graph (graph-rag.md §5): claim là khẳng định quan hệ giữa hai thực
 * thể → thử map sang cạnh `RELATED` trong Neo4j → `chunkIds` của cạnh →
 * document. Chỉ chạy khi Graph RAG bật và Neo4j sống; lỗi → bỏ qua (best-effort).
 */
@Injectable()
export class CitationService {
  private readonly logger = new Logger(CitationService.name);
  private readonly relationshipDefault: boolean;

  constructor(
    private readonly neo4j: Neo4jService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.relationshipDefault = config.get('citation', {
      infer: true,
    }).relationshipCitations;
  }

  async build(
    claims: readonly Claim[],
    evidence: readonly Evidence[],
    chunks: readonly RetrievedChunk[],
    opts: CitationBuildOptions = {},
  ): Promise<CitationBuildResult> {
    const byChunkId = new Map(chunks.map((c) => [c.chunkId, c]));
    const evByClaim = new Map(evidence.map((e) => [e.claimId, e]));
    const relEnabled =
      (opts.relationshipCitations ?? this.relationshipDefault) &&
      this.neo4j.enabled &&
      this.neo4j.isConnected;

    const citations: Citation[] = [];
    const stats = {
      chunkCitations: 0,
      relationshipCitations: 0,
      invalidClaims: 0,
      relationshipLookups: 0,
    };

    for (const claim of claims) {
      const ev = evByClaim.get(claim.id);
      const chunkIds = ev?.supported ? ev.evidenceChunkIds : [];

      const claimCitations: Citation[] = [];
      for (const chunkId of chunkIds) {
        const chunk = byChunkId.get(chunkId);
        if (!chunk) continue;
        claimCitations.push({
          claimId: claim.id,
          claimText: claim.text,
          kind: 'chunk',
          documentId: chunk.documentId,
          chunkId: chunk.chunkId,
          page: chunk.page,
          section: chunk.section,
          valid: true,
        });
      }

      // Claim chưa có citation chunk → thử map quan hệ (nếu bật).
      if (
        claimCitations.length === 0 &&
        relEnabled &&
        stats.relationshipLookups < MAX_RELATIONSHIP_LOOKUPS
      ) {
        stats.relationshipLookups++;
        const rel = await this.tryRelationshipCitation(claim, chunks);
        if (rel) claimCitations.push(rel);
      }

      if (claimCitations.length === 0) {
        stats.invalidClaims++;
        citations.push({
          claimId: claim.id,
          claimText: claim.text,
          kind: 'chunk',
          documentId: '',
          chunkId: '',
          valid: false,
        });
        continue;
      }

      for (const c of claimCitations) {
        if (c.kind === 'relationship') stats.relationshipCitations++;
        else stats.chunkCitations++;
        citations.push(c);
      }
    }

    return { citations, stats };
  }

  /**
   * Claim có ≥ 2 danh từ riêng khớp tên thực thể + hai thực thể đó nối nhau bằng
   * cạnh RELATED có `chunkIds` → citation quan hệ. Best-effort: Neo4j lỗi → null.
   */
  private async tryRelationshipCitation(
    claim: Claim,
    chunks: readonly RetrievedChunk[],
  ): Promise<Citation | null> {
    const names = properNouns(claim.text)
      .map((n) => n.toLowerCase())
      .filter((n) => n.length >= 2);
    if (names.length < 2) return null;

    const contextChunkIds = new Set(chunks.map((c) => c.chunkId));
    const contextDocIds = new Set(chunks.map((c) => c.documentId));

    try {
      const rows = await this.neo4j.read<{
        source: string;
        target: string;
        relType: string;
        chunkIds: string[];
        documentIds: string[];
      }>(
        `MATCH (a:Entity)-[r:RELATED]-(b:Entity)
         WHERE toLower(a.name) IN $names AND toLower(b.name) IN $names
               AND a.name < b.name
         RETURN a.name AS source, b.name AS target, r.type AS relType,
                coalesce(r.chunkIds, []) AS chunkIds,
                coalesce(r.documentIds, []) AS documentIds
         LIMIT 5`,
        { names },
      );

      for (const row of rows) {
        // Ưu tiên cạnh có chunk nằm trong ngữ cảnh đã dùng (bằng chứng thấy được).
        const sharedChunk = row.chunkIds.find((id) => contextChunkIds.has(id));
        const chunkId = sharedChunk ?? row.chunkIds[0];
        if (!chunkId) continue;
        const documentId =
          row.documentIds.find((id) => contextDocIds.has(id)) ??
          row.documentIds[0] ??
          '';
        return {
          claimId: claim.id,
          claimText: claim.text,
          kind: 'relationship',
          documentId,
          chunkId,
          sourceEntity: row.source,
          targetEntity: row.target,
          relationType: row.relType,
          valid: true,
        };
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Relationship citation lookup lỗi (bỏ qua): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
