import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RerankedChunk, RetrievedChunk } from '../../../common/types';
import type { AppConfig } from '../../../config/configuration';
import { withTimeout } from '../../../common/utils';
import type {
  ProviderRerankResult,
  RerankerProvider,
} from '../reranker.interface';

/** ~1200 ký tự ≈ 200-300 token tiếng Việt/chunk — đủ ngữ cảnh, request còn gọn. */
const CHUNK_CLIP = 1200;

function clip(text: string): string {
  return text.length > CHUNK_CLIP ? text.slice(0, CHUNK_CLIP) + '…' : text;
}

/**
 * Ép điểm về khoảng (0, 1). Endpoint kiểu Jina/Cohere trả sẵn [0,1]; llama.cpp
 * `--pooling rank` với Qwen3-Reranker trả logit chưa chuẩn hoá → sigmoid (đơn
 * điệu nên giữ nguyên thứ tự) để downstream (ngưỡng relevance ở grounding /
 * abstention) không bị lệch thang.
 */
function normalizeScore(s: number): number {
  if (!Number.isFinite(s)) return 0;
  if (s >= 0 && s <= 1) return s;
  return 1 / (1 + Math.exp(-s));
}

interface RerankItem {
  index: number;
  relevance_score?: number;
  score?: number;
}

/**
 * Reranker gọi endpoint HTTP `/v1/rerank` tương thích Jina (PROMPT §19).
 *
 * Ollama KHÔNG có endpoint rerank — chạy `llama-server -m Qwen3-Reranker-0.6B
 * --reranking --pooling rank` (cổng riêng) rồi trỏ `RERANK_BASE_URL` vào đó.
 * Cùng shape API với Infinity / text-embeddings-inference / vLLM `/rerank`, nên
 * một provider này phủ mọi backend.
 *
 * Nội dung chunk là VĂN BẢN THÔ từ tài liệu (§23) — ở đây chỉ là phần tử mảng
 * `documents`, không nhúng vào prompt lệnh nào.
 *
 * `rerank()` CÓ THỂ ném (HTTP lỗi / timeout) — `RerankerService` bắt và fallback
 * về identity để một lỗi reranker không bao giờ làm hỏng truy vấn (§54).
 */
@Injectable()
export class ApiRerankerProvider implements RerankerProvider {
  readonly name = 'api';
  private readonly logger = new Logger(ApiRerankerProvider.name);
  private readonly cfg: AppConfig['rerank'];
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('rerank', { infer: true });
    this.timeoutMs = config.get('llm', { infer: true }).timeoutMs;
  }

  isConfigured(): boolean {
    return !!this.cfg.baseUrl && !!this.cfg.model;
  }

  private endpoint(): string {
    const base = (this.cfg.baseUrl ?? '').replace(/\/+$/, '');
    return base.endsWith('/rerank') ? base : `${base}/rerank`;
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<ProviderRerankResult> {
    if (chunks.length === 0) {
      return {
        chunks: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
      };
    }

    const documents = chunks.map((c) => clip(c.content));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;

    const res = await withTimeout(
      (signal) =>
        fetch(this.endpoint(), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.cfg.model,
            query,
            documents,
            top_n: topK,
          }),
          signal,
        }),
      this.timeoutMs,
      'rerank.api',
    );

    if (!res.ok) {
      throw new Error(`Rerank API trả HTTP ${res.status}`);
    }

    const body: unknown = await res.json();
    const items: RerankItem[] = Array.isArray(body)
      ? (body as RerankItem[])
      : ((body as { results?: RerankItem[] })?.results ?? []);

    if (items.length === 0) {
      throw new Error('Rerank API trả danh sách kết quả rỗng');
    }

    const scoreByIndex = new Map<number, number>();
    for (const item of items) {
      if (typeof item?.index !== 'number') continue;
      const raw = item.relevance_score ?? item.score ?? 0;
      scoreByIndex.set(item.index, normalizeScore(raw));
    }

    const mapped = chunks.map((chunk, originalIndex) => ({
      chunk,
      rerankScore: scoreByIndex.get(originalIndex) ?? 0,
      originalIndex,
    }));

    // Giảm dần theo điểm; chunk không được nhắc (điểm 0) xuống cuối; cùng điểm
    // giữ thứ tự ban đầu.
    mapped.sort((a, b) =>
      b.rerankScore !== a.rerankScore
        ? b.rerankScore - a.rerankScore
        : a.originalIndex - b.originalIndex,
    );

    const rerankedChunks: RerankedChunk[] = mapped
      .slice(0, topK)
      .map((item, i) => ({
        ...item.chunk,
        rerankScore: item.rerankScore,
        rank: i,
      }));

    // API rerank không trả token usage — ước lượng để cost-tracking không trống.
    const inputTokens = documents.reduce(
      (sum, d) => sum + Math.ceil((query.length + d.length) / 4),
      0,
    );

    return {
      chunks: rerankedChunks,
      usage: { inputTokens, outputTokens: 0, estimatedCost: 0 },
    };
  }
}
