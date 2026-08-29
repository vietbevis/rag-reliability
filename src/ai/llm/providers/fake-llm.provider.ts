import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { TokenUsage } from '../../../common/types';
import { LlmProvider } from '../llm-provider.enum';
import type {
  ChatMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  StructuredResult,
} from '../llm.interface';

/**
 * LLM TẤT ĐỊNH cho CI/dev (đối xứng với {@link FakeEmbeddingProvider}). KHÔNG
 * suy luận thật — chỉ đủ để chạy toàn bộ pipeline RAG/graph mà không cần API
 * key. Không dùng cho production.
 *
 * - `chat`: trả câu trích xuất (câu đầu tiên của context/last user message) +
 *   nhãn `[fake]` — faithfulness cao một cách nhân tạo, test được plumbing.
 * - `chatStructured`: dựng object hợp lệ theo schema Zod; với vài tên trường
 *   quen thuộc (`answer`, `status`, `entities`, `relationships`) thì điền
 *   heuristic (extractive answer / NER thô).
 */
@Injectable()
export class FakeLlmProvider implements LLMProvider {
  readonly provider = LlmProvider.FAKE;
  readonly defaultModel = 'fake-llm-v1';

  isConfigured(): boolean {
    return true;
  }

  chat(
    messages: ChatMessage[],
    options: LLMOptions = {},
  ): Promise<LLMResponse> {
    const started = Date.now();
    const content = `[fake] ${extractiveAnswer(messages)}`;
    return Promise.resolve({
      content,
      usage: usage(messages, content),
      model: options.model ?? this.defaultModel,
      provider: this.provider,
      latencyMs: Date.now() - started,
      finishReason: 'stop',
    });
  }

  async *chatStream(
    messages: ChatMessage[],
    options: LLMOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const full = (await this.chat(messages, options)).content;
    for (const word of full.split(' ')) {
      yield { delta: word + ' ', done: false };
    }
    yield { delta: '', done: true };
  }

  chatStructured<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    options: LLMOptions = {},
  ): Promise<StructuredResult<T>> {
    const started = Date.now();
    const raw = fakeValueForSchema(schema, {
      messages,
      sourceText: sourceText(messages),
    });
    const data = schema.parse(raw);
    return Promise.resolve({
      data,
      usage: usage(messages, JSON.stringify(data)),
      model: options.model ?? this.defaultModel,
      provider: this.provider,
      latencyMs: Date.now() - started,
    });
  }
}

// --- helpers ------------------------------------------------------------

function sourceText(messages: ChatMessage[]): string {
  const user = [...messages].reverse().find((m) => m.role === 'user');
  return (user?.content ?? messages.map((m) => m.content).join('\n')).trim();
}

function extractiveAnswer(messages: ChatMessage[]): string {
  const text = sourceText(messages);
  // Prompt RAG có mục đánh số [1] (...) nội dung → trích câu đầu của mục [1].
  const ctxItem = /\[1\]\s*(?:\([^)]*\)\s*)?([^\n]+)/.exec(text)?.[1];
  const base = ctxItem ?? text;
  const firstSentence = base.split(/(?<=[.!?…])\s/)[0] ?? base;
  return firstSentence.slice(0, 300) || 'không có nội dung';
}

interface FakeCtx {
  messages: ChatMessage[];
  sourceText: string;
}

/** Dựng giá trị hợp lệ tối thiểu từ một schema Zod 4 (introspect `.def`). */
export function fakeValueForSchema(
  schema: unknown,
  ctx: FakeCtx,
  fieldName?: string,
): unknown {
  const def = (schema as { def?: Record<string, unknown> }).def;
  if (!def) return undefined;
  const type = def.type as string;

  switch (type) {
    case 'string':
      return fakeString(fieldName, ctx);
    case 'number':
      return fieldName === 'strength' ? 5 : 0;
    case 'boolean':
      return false;
    case 'literal':
      return (def.values as unknown[])[0];
    case 'enum': {
      const values = Object.values(def.entries as Record<string, unknown>);
      if (fieldName === 'status') {
        const grounded = values.find((v) => v === 'GROUNDED');
        return grounded ?? values[0];
      }
      return values[0];
    }
    case 'array':
      return fakeArray(def.element, ctx, fieldName);
    case 'object': {
      const shape = def.shape as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(shape)) {
        const v = fakeValueForSchema(sub, ctx, key);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'nonoptional':
    case 'readonly':
      return fakeValueForSchema(def.innerType, ctx, fieldName);
    case 'union': {
      const opts = def.options as unknown[];
      return fakeValueForSchema(opts[0], ctx, fieldName);
    }
    case 'pipe':
      return fakeValueForSchema(def.out ?? def.in, ctx, fieldName);
    case 'record':
      return {};
    default:
      return undefined;
  }
}

function fakeString(fieldName: string | undefined, ctx: FakeCtx): string {
  switch (fieldName) {
    case 'answer':
    case 'response':
    case 'text':
      return `[fake] ${extractiveAnswer(ctx.messages)}`;
    case 'name':
      return properNouns(ctx.sourceText)[0] ?? 'Thực thể';
    case 'description':
      return ctx.sourceText.slice(0, 120);
    case 'type':
      return 'CONCEPT';
    default:
      return `fake:${fieldName ?? 'value'}`;
  }
}

function fakeArray(
  element: unknown,
  ctx: FakeCtx,
  fieldName: string | undefined,
): unknown[] {
  if (fieldName === 'entities') {
    return properNouns(ctx.sourceText)
      .slice(0, 5)
      .map((name) => ({
        name,
        type: 'CONCEPT',
        description: `Xuất hiện trong: ${ctx.sourceText.slice(0, 80)}`,
      }));
  }
  if (fieldName === 'relationships') {
    const nouns = properNouns(ctx.sourceText).slice(0, 4);
    const rels: unknown[] = [];
    for (let i = 0; i + 1 < nouns.length; i++) {
      rels.push({
        source: nouns[i],
        target: nouns[i + 1],
        type: 'RELATED_TO',
        description: 'Đồng xuất hiện',
        strength: 5,
      });
    }
    return rels;
  }
  if (
    (fieldName === 'usedContext' || fieldName === 'citationIndexes') &&
    /\[1\]/.test(ctx.sourceText)
  ) {
    return /\[2\]/.test(ctx.sourceText) ? [1, 2] : [1];
  }
  // Mặc định: mảng rỗng (claims, citationIds... — an toàn).
  void element;
  return [];
}

/** NER thô: cụm 1-4 từ bắt đầu bằng chữ hoa (kể cả tiếng Việt có dấu). */
export function properNouns(text: string): string[] {
  const matches =
    text.match(/\p{Lu}[\p{L}]*(?:\s+\p{Lu}[\p{L}]*){0,3}/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const t = m.trim();
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function usage(messages: ChatMessage[], output: string): TokenUsage {
  const inputTokens = Math.ceil(
    messages.reduce((n, m) => n + m.content.length, 0) / 4,
  );
  const outputTokens = Math.ceil(output.length / 4);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: 0,
  };
}
