import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { ChatMessage } from '../../ai/llm/llm.interface';
import { LlmService } from '../../ai/llm/llm.service';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import {
  graphExtractionSchema,
  type GraphExtractionOutput,
} from './entity-extraction.schema';
import type { ExtractedEntity, ExtractedRelationship } from './graph.types';

export interface ChunkExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  /**
   * Lời gọi trích chính vẫn ra output sai schema sau khi đã thử lại — kết quả
   * rỗng KHÔNG đáng tin, orchestrator không được cache (để lần sau trích lại).
   */
  failed: boolean;
}

/** Số lần gọi tối đa cho MỘT bước trích khi output sai schema (1 + thử lại). */
const SCHEMA_ATTEMPTS = 2;

interface LlmCallUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

type LlmCallResult = GraphExtractionOutput & {
  usage: LlmCallUsage;
  /** Số lời gọi LLM thật đã tốn (gồm cả lần thử lại). */
  calls: number;
  failed: boolean;
};

/**
 * Trích entity + quan hệ từ MỘT chunk bằng structured output (graph-rag.md §3).
 *
 * - Prompt nghiêm ngặt "chỉ dùng văn bản được cấp" (PROMPT §23), giới hạn loại
 *   thực thể theo `GRAPH_ENTITY_TYPES`.
 * - Gleaning: lặp tối đa `GRAPH_EXTRACT_GLEANINGS` lần hỏi "còn sót không?".
 * - Post-validate: loại entity mà tên không xuất hiện trong text (đã chuẩn hoá);
 *   loại quan hệ có đầu mút không thuộc danh sách entity.
 * - KHÔNG tự cache / gọi DB — orchestrator lo việc đó.
 */
@Injectable()
export class EntityExtractorService {
  private readonly logger = new Logger(EntityExtractorService.name);
  private readonly cfg: AppConfig['graph']['extract'];

  constructor(
    private readonly llm: LlmService,
    private readonly tokens: TokenCounterService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('graph', { infer: true }).extract;
  }

  get promptVersion(): string {
    return this.cfg.promptVersion;
  }

  /** Model thực dùng cho extraction — `GRAPH_EXTRACT_MODEL` hoặc model chính. */
  get model(): string {
    return this.cfg.model ?? this.llm.activeModel;
  }

  async extract(chunkText: string): Promise<ChunkExtractionResult> {
    const text = this.clip(chunkText);
    const acc: ChunkExtractionResult = {
      entities: [],
      relationships: [],
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      failed: false,
    };

    const initial = await this.callLlm(this.initialMessages(text), text);
    this.merge(acc, initial);
    // Lời gọi chính hỏng → gleaning vô nghĩa (không có gì để hỏi "còn sót").
    if (initial.failed) {
      acc.failed = true;
      return acc;
    }

    for (let round = 0; round < this.cfg.gleanings; round++) {
      const before = acc.entities.length + acc.relationships.length;
      this.merge(
        acc,
        await this.callLlm(this.gleaningMessages(text, acc.entities), text),
      );
      if (acc.entities.length + acc.relationships.length === before) break;
    }

    return acc;
  }

  // --- LLM ------------------------------------------------------------

  private async callLlm(
    messages: ChatMessage[],
    sourceText: string,
  ): Promise<LlmCallResult> {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await this.llm.chatStructured(messages, graphExtractionSchema, {
          temperature: 0,
          traceLabel: 'graph.extract',
          model: this.cfg.model,
          // Graph extraction là NER có ràng buộc schema. Model "thinking" +
          // structured output/tool_choice: hoặc bị API từ chối, hoặc chậm gấp
          // nhiều lần. Tắt cứng reasoning ở MỌI model.
          reasoning: false,
        });
      } catch (err) {
        // Lỗi hạ tầng (timeout, network, rate limit) vẫn ném để retry cả job.
        if (!isSchemaValidationError(err)) throw err;
        // Output sai schema thường ngẫu nhiên (model/proxy lúc tuân thủ lúc
        // không) → thử lại; hết lượt thì báo `failed`, KHÔNG làm hỏng cả job.
        if (attempt < SCHEMA_ATTEMPTS) {
          this.logger.warn(
            `graph.extract: output không hợp schema — thử lại (${attempt}/${SCHEMA_ATTEMPTS}). ${truncate(err)}`,
          );
          continue;
        }
        this.logger.warn(
          `graph.extract: output không hợp schema sau ${attempt} lần — bỏ qua chunk. ${truncate(err)}`,
        );
        return {
          entities: [],
          relationships: [],
          usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
          calls: attempt,
          failed: true,
        };
      }
      return {
        ...this.postValidate(res.data, sourceText),
        usage: {
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          estimatedCost: res.usage.estimatedCost,
        },
        calls: attempt,
        failed: false,
      };
    }
  }

  private merge(acc: ChunkExtractionResult, part: LlmCallResult): void {
    acc.llmCalls += part.calls;
    acc.inputTokens += part.usage.inputTokens;
    acc.outputTokens += part.usage.outputTokens;
    acc.estimatedCost += part.usage.estimatedCost;

    const seenE = new Set(
      acc.entities.map((e) => `${norm(e.name)}|${norm(e.type)}`),
    );
    for (const e of part.entities) {
      const k = `${norm(e.name)}|${norm(e.type)}`;
      if (!seenE.has(k)) {
        seenE.add(k);
        acc.entities.push(e);
      }
    }
    const seenR = new Set(
      acc.relationships.map(
        (r) => `${norm(r.source)}|${norm(r.target)}|${norm(r.type)}`,
      ),
    );
    for (const r of part.relationships) {
      const k = `${norm(r.source)}|${norm(r.target)}|${norm(r.type)}`;
      const kRev = `${norm(r.target)}|${norm(r.source)}|${norm(r.type)}`;
      if (!seenR.has(k) && !seenR.has(kRev)) {
        seenR.add(k);
        acc.relationships.push(r);
      }
    }
  }

  // --- post-validate -------------------------------------------------

  private postValidate(
    out: GraphExtractionOutput,
    sourceText: string,
  ): GraphExtractionOutput {
    const haystack = norm(sourceText);
    const allowedTypes = new Set(this.cfg.entityTypes);

    const entities = out.entities
      .map((e) => ({
        name: e.name.trim(),
        type: e.type.trim().toUpperCase(),
        description: e.description.trim(),
      }))
      .filter((e) => e.name.length >= 2 && haystack.includes(norm(e.name)))
      .map((e) => ({
        ...e,
        // Loại lạ → CONCEPT (giữ thực thể, chuẩn hoá loại).
        type: allowedTypes.has(e.type) ? e.type : 'CONCEPT',
      }));

    const names = new Set(entities.map((e) => norm(e.name)));
    const relationships = out.relationships
      .map((r) => ({
        source: r.source.trim(),
        target: r.target.trim(),
        type: r.type.trim().toUpperCase().replace(/\s+/g, '_') || 'RELATED_TO',
        description: r.description.trim(),
        strength: clampStrength(r.strength),
      }))
      .filter(
        (r) =>
          norm(r.source) !== norm(r.target) &&
          names.has(norm(r.source)) &&
          names.has(norm(r.target)),
      );

    return { entities, relationships };
  }

  // --- prompts ------------------------------------------------------

  private initialMessages(text: string): ChatMessage[] {
    return [
      { role: 'system', content: this.systemPrompt() },
      {
        role: 'user',
        content:
          `Trích toàn bộ thực thể và quan hệ từ VĂN BẢN dưới đây. ` +
          `Chỉ dùng thông tin có trong văn bản, không suy diễn thêm.\n\n` +
          `VĂN BẢN:\n${text}`,
      },
    ];
  }

  private gleaningMessages(
    text: string,
    found: ExtractedEntity[],
  ): ChatMessage[] {
    const list =
      found.map((e) => `- ${e.name} (${e.type})`).join('\n') || '(chưa có)';
    return [
      { role: 'system', content: this.systemPrompt() },
      {
        role: 'user',
        content:
          `VĂN BẢN:\n${text}\n\n` +
          `Đã trích được các thực thể:\n${list}\n\n` +
          `CÒN thực thể hoặc quan hệ nào trong văn bản CHƯA có ở trên không? ` +
          `Trả về CHỈ những mục còn thiếu. Nếu không còn, trả về mảng rỗng.`,
      },
    ];
  }

  private systemPrompt(): string {
    return (
      `Bạn là hệ thống trích xuất tri thức. Nhiệm vụ: đọc một đoạn văn bản và ` +
      `liệt kê các thực thể (entity) cùng quan hệ (relationship) GIỮA CÁC THỰC ` +
      `THỂ ĐÓ.\n` +
      `- Loại thực thể ưu tiên: ${this.cfg.entityTypes.join(', ')} ` +
      `(loại khác dùng CONCEPT).\n` +
      `- Tên thực thể phải là cụm từ XUẤT HIỆN NGUYÊN VĂN trong văn bản.\n` +
      `- Quan hệ chỉ nối hai thực thể đã liệt kê; mô tả ngắn gọn bản chất quan ` +
      `hệ; strength 1..10 theo mức rõ ràng của quan hệ trong văn bản.\n` +
      `- Không bịa. Không dùng kiến thức ngoài văn bản. Nếu không có gì, trả rỗng.`
    );
  }

  private clip(text: string): string {
    const budget = this.cfg.maxTokens;
    if (this.tokens.count(text) <= budget) return text.trim();
    // Cắt thô theo tỉ lệ ký tự/token ~4; giữ phần đầu chunk.
    const approxChars = budget * 4;
    this.logger.warn(
      `Chunk dài hơn GRAPH_EXTRACT_MAX_TOKENS (${budget}) — cắt bớt để extract`,
    );
    return text.slice(0, approxChars).trim();
  }
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
}

function clampStrength(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** Lỗi do output LLM không khớp Zod schema (khác lỗi hạ tầng — timeout/network). */
function isSchemaValidationError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; cause?: { name?: string } };
  return (
    e?.name === 'ZodError' ||
    e?.cause?.name === 'ZodError' ||
    e?.code === 'BAD_REQUEST' ||
    e?.code === 'UNKNOWN'
  );
}

function truncate(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}
