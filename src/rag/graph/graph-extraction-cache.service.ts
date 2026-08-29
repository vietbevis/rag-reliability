import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { sha256 } from '../../common/utils';
import { Prisma } from '../../generated/prisma/client';
import {
  graphExtractionSchema,
  type GraphExtractionOutput,
} from './entity-extraction.schema';

export interface CachedExtraction extends GraphExtractionOutput {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Cache kết quả extraction theo `(sha256(chunkText), model, promptVersion)`
 * (graph-rag.md §0 "Chi phí có trần"). Re-ingest cùng nội dung / cùng prompt →
 * không gọi lại LLM. Dữ liệu cache vẫn validate qua Zod khi đọc (phòng schema
 * đổi).
 */
@Injectable()
export class GraphExtractionCacheService {
  constructor(private readonly prisma: PrismaService) {}

  hash(chunkText: string): string {
    return sha256(chunkText);
  }

  async get(
    chunkHash: string,
    model: string,
    promptVersion: string,
  ): Promise<CachedExtraction | null> {
    const row = await this.prisma.graphExtractionCache.findUnique({
      where: {
        chunkHash_model_promptVersion: { chunkHash, model, promptVersion },
      },
    });
    if (!row) return null;
    const parsed = graphExtractionSchema.safeParse({
      entities: row.entities,
      relationships: row.relationships,
    });
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    };
  }

  async put(
    chunkHash: string,
    model: string,
    promptVersion: string,
    data: CachedExtraction,
  ): Promise<void> {
    const payload = {
      entities: data.entities as unknown as Prisma.InputJsonValue,
      relationships: data.relationships as unknown as Prisma.InputJsonValue,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    };
    await this.prisma.graphExtractionCache.upsert({
      where: {
        chunkHash_model_promptVersion: { chunkHash, model, promptVersion },
      },
      create: { chunkHash, model, promptVersion, ...payload },
      update: payload,
    });
  }
}
