import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmbeddingError } from '../common/errors';
import { RetrievalService } from './retrieval/retrieval.service';
import { RagPipelineService } from './pipeline/rag-pipeline.service';
import { RagQueryDto, RagSearchDto } from './dto/rag-query.dto';

@ApiTags('rag')
@Controller('rag')
export class RagController {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly pipeline: RagPipelineService,
  ) {}

  @Post('search')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Chỉ truy hồi, KHÔNG gọi LLM — debug retrieval (PROMPT §40)',
  })
  async search(@Body() dto: RagSearchDto) {
    const res = await this.retrieval.retrieve({
      query: dto.query,
      topK: dto.topK,
      filters: dto.filters,
    });
    if (res.error) {
      // Lỗi hạ tầng truy hồi → 502, không trả 200 với 0 kết quả (PROMPT §54).
      throw new EmbeddingError('UNKNOWN', `Truy hồi thất bại: ${res.error}`);
    }
    return {
      query: res.query,
      strategy: res.strategy,
      count: res.chunks.length,
      latencyMs: res.latencyMs,
      usage: res.usage,
      results: res.chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        score: c.score,
        source: c.source,
        heading: c.heading,
        section: c.section,
        page: c.page,
        content: c.content,
        metadata: c.metadata,
      })),
    };
  }

  @Post('query')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Truy vấn RAG đầy đủ: retrieve → context → validate → generate (PROMPT §41)',
  })
  query(@Body() dto: RagQueryDto) {
    return this.pipeline.query(
      { query: dto.query, topK: dto.topK, filters: dto.filters },
      { rethrow: true },
    );
  }
}
