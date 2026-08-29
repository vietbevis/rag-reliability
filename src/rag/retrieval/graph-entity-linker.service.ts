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
}

const QUERY_ENTITIES_SCHEMA = z.object({
  entities: z.array(z.string().min(1).max(200)).max(20).default([]),
});

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };

/**
 * Nối câu hỏi → thực thể trong graph (graph-rag.md §0, "Entity linking khi truy
 * vấn"). 3 tầng, dừng ở tầng đầu tiên có kết quả:
 *
 *   1. Tên thực thể là chuỗi con (chuẩn hoá) của query — rẻ, không LLM.
 *   2. Alias (bảng `EntityAlias`) — HOÃN sang sau (chưa có bảng).
 *   3. LLM rút danh sách thực thể từ query, khớp lại với `Entity.name`.
 *
 * Neo4j chết → trả seed rỗng (GraphRetriever sẽ trả []). Không ném.
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
    // Tầng 1 — chuỗi con.
    const bySubstring = await this.matchBySubstring(query);
    if (bySubstring.seedKeys.length) {
      return { ...bySubstring, method: 'substring', usage: EMPTY_USAGE };
    }

    // Tầng 3 — LLM rút thực thể rồi khớp tên.
    if (this.useLlm) {
      const byLlm = await this.matchByLlm(query);
      if (byLlm.seedKeys.length) return { ...byLlm, method: 'llm' };
    }

    return {
      seedKeys: [],
      linkedNames: [],
      method: 'none',
      usage: EMPTY_USAGE,
    };
  }

  private async matchBySubstring(
    query: string,
  ): Promise<{ seedKeys: string[]; linkedNames: string[] }> {
    const q = norm(query);
    try {
      const rows = await this.neo4j.read<{ key: string; name: string }>(
        `MATCH (e:Entity)
         WHERE size(e.name) >= 3 AND toLower($q) CONTAINS toLower(e.name)
         RETURN e.key AS key, e.name AS name
         ORDER BY size(e.name) DESC
         LIMIT 20`,
        { q },
      );
      return {
        seedKeys: rows.map((r) => r.key),
        linkedNames: rows.map((r) => r.name),
      };
    } catch (err) {
      this.logger.warn(
        `Entity linking (substring) lỗi: ${(err as Error).message}`,
      );
      return { seedKeys: [], linkedNames: [] };
    }
  }

  private async matchByLlm(query: string): Promise<{
    seedKeys: string[];
    linkedNames: string[];
    usage: EntityLinkResult['usage'];
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
      return { seedKeys: [], linkedNames: [], usage };
    }
  }
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
}
