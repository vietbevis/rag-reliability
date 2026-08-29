import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../../config/configuration';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { LlmService } from '../../ai/llm/llm.service';
import { Neo4jService } from '../../graph/neo4j.service';

export interface EntityLinkResult {
  /** `Entity.key` các thực thể seed để traversal. */
  seedKeys: string[];
  /** Tên thực thể đã khớp (để trace). */
  linkedNames: string[];
  method: 'substring' | 'llm' | 'none';
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
  /**
   * Set khi truy vấn Neo4j LỖI (không phải "không khớp"). GraphRetriever PHẢI
   * coi đây là lỗi hạ tầng: tính vào circuit-breaker, trả `trace.error` (§54) —
   * KHÔNG được nhầm với `no_seed_entity`.
   */
  error?: 'neo4j_unavailable';
}

const QUERY_ENTITIES_SCHEMA = z.object({
  entities: z.array(z.string().min(1).max(200)).max(20).default([]),
});

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };

/**
 * Nối câu hỏi → thực thể trong graph (graph-rag.md §0, "Entity linking khi truy
 * vấn"). 3 tầng, dừng ở tầng đầu tiên có kết quả:
 *
 *   1. Fulltext index `entity_name_fts` lấy ứng viên + hậu lọc "tên xuất hiện
 *      trong query, đa từ / đủ dài" — rẻ, không LLM.
 *   2. Alias (bảng `EntityAlias`) — HOÃN sang sau (chưa có bảng).
 *   3. LLM rút danh sách thực thể từ query, khớp lại với `Entity.name`.
 *
 * KHÔNG ném. Neo4j LỖI (khác "không khớp") → `error: 'neo4j_unavailable'` để
 * GraphRetriever tính vào circuit-breaker và báo lỗi hạ tầng (§54).
 */
@Injectable()
export class GraphEntityLinkerService {
  private readonly logger = new Logger(GraphEntityLinkerService.name);
  private readonly useLlm: boolean;

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly llm: LlmService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.useLlm = config.get('graph', { infer: true }).retrieval.linkUseLlm;
  }

  async link(query: string): Promise<EntityLinkResult> {
    // Tầng 1 — fulltext trên Entity.name + hậu lọc "tên xuất hiện trong query".
    const bySubstring = await this.matchByName(query);
    if (bySubstring.error) {
      return {
        seedKeys: [],
        linkedNames: [],
        method: 'none',
        usage: EMPTY_USAGE,
        error: bySubstring.error,
      };
    }
    if (bySubstring.seedKeys.length) {
      return { ...bySubstring, method: 'substring', usage: EMPTY_USAGE };
    }

    // Tầng 3 — LLM rút thực thể rồi khớp tên.
    if (this.useLlm) {
      const byLlm = await this.matchByLlm(query);
      if (byLlm.error) {
        return {
          seedKeys: [],
          linkedNames: [],
          method: 'none',
          usage: byLlm.usage,
          error: byLlm.error,
        };
      }
      if (byLlm.seedKeys.length) return { ...byLlm, method: 'llm' };
    }

    return {
      seedKeys: [],
      linkedNames: [],
      method: 'none',
      usage: EMPTY_USAGE,
    };
  }

  /**
   * Tầng 1: fulltext index `entity_name` trên Neo4j (`db.index.fulltext.
   * queryNodes`) lấy ứng viên, rồi HẬU LỌC trong TS: tên (chuẩn hoá) phải là
   * chuỗi con của query VÀ (đa từ HOẶC đủ dài) — chặn false-positive từ ngắn
   * kiểu "Nam", "Ban", "Văn" khớp mọi câu tiếng Việt.
   */
  private async matchByName(query: string): Promise<{
    seedKeys: string[];
    linkedNames: string[];
    error?: 'neo4j_unavailable';
  }> {
    const q = norm(query);
    const lucene = toLucene(query);
    if (!lucene) return { seedKeys: [], linkedNames: [] };
    try {
      const rows = await this.neo4j.read<{ key: string; name: string }>(
        `CALL db.index.fulltext.queryNodes('entity_name_fts', $lucene)
         YIELD node, score
         RETURN node.key AS key, node.name AS name
         ORDER BY score DESC
         LIMIT 50`,
        { lucene },
      );
      const kept = rows.filter((r) => {
        const n = norm(r.name);
        const words = n.split(' ').length;
        return q.includes(n) && (words >= 2 || n.length >= 6);
      });
      return {
        seedKeys: [...new Set(kept.map((r) => r.key))].slice(0, 20),
        linkedNames: kept.map((r) => r.name),
      };
    } catch (err) {
      this.logger.warn(
        `Entity linking (fulltext) lỗi: ${(err as Error).message}`,
      );
      return { seedKeys: [], linkedNames: [], error: 'neo4j_unavailable' };
    }
  }

  private async matchByLlm(query: string): Promise<{
    seedKeys: string[];
    linkedNames: string[];
    usage: EntityLinkResult['usage'];
    error?: 'neo4j_unavailable';
  }> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Liệt kê các thực thể (người, tổ chức, địa điểm, khái niệm, mã/số hiệu) ' +
          'được NHẮC TỚI trong câu hỏi. Chỉ trả tên xuất hiện trong câu hỏi, không suy diễn.',
      },
      { role: 'user', content: query },
    ];
    let names: string[];
    let usage = EMPTY_USAGE;
    try {
      const res = await this.llm.chatStructured(
        messages,
        QUERY_ENTITIES_SCHEMA,
        {
          temperature: 0,
          traceLabel: 'graph.link.query-entities',
        },
      );
      names = res.data.entities;
      usage = {
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        estimatedCost: res.usage.estimatedCost,
      };
    } catch (err) {
      this.logger.warn(`Entity linking (LLM) lỗi: ${(err as Error).message}`);
      return { seedKeys: [], linkedNames: [], usage };
    }

    const normed = [...new Set(names.map(norm).filter((n) => n.length >= 2))];
    if (normed.length === 0) {
      return { seedKeys: [], linkedNames: [], usage };
    }

    try {
      const rows = await this.neo4j.read<{ key: string; name: string }>(
        `MATCH (e:Entity)
         WHERE toLower(e.name) IN $names
         RETURN e.key AS key, e.name AS name
         LIMIT 30`,
        { names: normed },
      );
      return {
        seedKeys: [...new Set(rows.map((r) => r.key))],
        linkedNames: rows.map((r) => r.name),
        usage,
      };
    } catch (err) {
      this.logger.warn(`Entity linking (match) lỗi: ${(err as Error).message}`);
      return {
        seedKeys: [],
        linkedNames: [],
        usage,
        error: 'neo4j_unavailable',
      };
    }
  }
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Query người dùng → chuỗi Lucene an toàn cho `db.index.fulltext.queryNodes`:
 * bỏ ký tự đặc biệt Lucene, mỗi từ ≥2 ký tự thành một term OR.
 */
function toLucene(query: string): string {
  const terms = query
    .replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return terms.join(' OR ');
}
