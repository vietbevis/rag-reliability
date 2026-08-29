import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
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
    private readonly prisma: PrismaService,
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
      strategy: dto.strategy,
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
      {
        query: dto.query,
        topK: dto.topK,
        filters: dto.filters,
        strategy: dto.strategy,
        rerank: dto.rerank,
        strict: dto.strict,
        cite: dto.cite,
        faithfulness: dto.faithfulness,
      },
      { rethrow: true },
    );
  }

  @Get('queries')
  @ApiOperation({
    summary: 'Liệt kê lịch sử truy vấn RAG phục vụ audit và monitoring (PROMPT §38)',
  })
  async listQueries(
    @Query('take') take?: number,
    @Query('status') status?: string,
  ) {
    const limit = Math.min(take ? Number(take) : 50, 100);
    const queries = await this.prisma.ragQuery.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        query: true,
        status: true,
        answer: true,
        faithfulness: true,
        provider: true,
        model: true,
        latencyMs: true,
        error: true,
        createdAt: true,
      },
    });
    return queries;
  }

  @Get('queries/:id')
  @ApiOperation({
    summary: 'Chi tiết một truy vấn RAG kèm citations và claims (PROMPT §38)',
  })
  async getQuery(@Param('id') id: string) {
    const q = await this.prisma.ragQuery.findUnique({
      where: { id },
      include: {
        citations: true,
      },
    });
    if (!q) throw new NotFoundException(`RAG Query ${id} không tồn tại`);
    return q;
  }

  @Get('queries/:id/trace')
  @ApiOperation({
    summary: 'Xem chi tiết trace timeline và telemetry từng chặng của truy vấn (PROMPT §38)',
  })
  async getQueryTrace(@Param('id') id: string) {
    const q = await this.prisma.ragQuery.findUnique({
      where: { id },
      select: {
        id: true,
        query: true,
        status: true,
        latencyMs: true,
        usage: true,
        trace: true,
        createdAt: true,
      },
    });
    if (!q) throw new NotFoundException(`RAG Query ${id} không tồn tại`);
    return q;
  }
}
