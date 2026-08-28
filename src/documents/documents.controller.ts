import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { ChunkDocumentDto } from './dto/chunk-document.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { EmbedDocumentDto } from './dto/embed-document.dto';
import { ListChunksDto } from './dto/list-chunks.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import type { EmbeddingProviderName } from '../ai/llm/llm-provider.enum';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary:
      'Upload + ingest tài liệu (file multipart hoặc JSON text) — PROMPT §39',
  })
  create(
    @Body() dto: CreateDocumentDto,
    @UploadedFile(new ParseFilePipeBuilder().build({ fileIsRequired: false }))
    file?: Express.Multer.File,
  ) {
    return this.documents.create({
      dto,
      file: file
        ? {
            buffer: file.buffer,
            originalname: file.originalname,
            mimetype: file.mimetype,
          }
        : undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Liệt kê tài liệu' })
  list(@Query() query: ListDocumentsDto) {
    return this.documents.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một tài liệu — PROMPT §39' })
  findOne(@Param('id') id: string) {
    return this.documents.findOne(id);
  }

  @Get(':id/jobs')
  @ApiOperation({ summary: 'Các stage ingestion + thời gian của tài liệu' })
  jobs(@Param('id') id: string) {
    return this.documents.listJobs(id);
  }

  @Get(':id/chunks')
  @ApiOperation({ summary: 'Danh sách chunk của tài liệu — PROMPT §39' })
  chunks(@Param('id') id: string, @Query() query: ListChunksDto) {
    return this.documents.listChunks(id, query);
  }

  @Get(':id/embeddings')
  @ApiOperation({
    summary: 'Tóm tắt embedding của tài liệu (theo provider/model)',
  })
  embeddings(@Param('id') id: string) {
    return this.documents.embeddingSummary(id);
  }

  @Post(':id/ingest')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Chạy lại pipeline (ingest → chunk → embedding) — PROMPT §39',
  })
  reingest(@Param('id') id: string) {
    return this.documents.reingest(id);
  }

  @Post(':id/chunk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Chạy lại chunking (chọn strategy để benchmark)' })
  chunk(@Param('id') id: string, @Body() dto: ChunkDocumentDto) {
    return this.documents.chunk(id, dto.strategy);
  }

  @Post(':id/embed')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sinh + lưu embedding cho toàn bộ chunk (PROMPT §14)',
  })
  embed(@Param('id') id: string, @Body() dto: EmbedDocumentDto) {
    return this.documents.embed(
      id,
      dto.provider as EmbeddingProviderName | undefined,
    );
  }
}
