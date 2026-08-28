import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { EmbeddingFactoryService } from './embeddings/embedding-factory.service';
import { LlmFactoryService } from './llm/llm-factory.service';
import { TestProviderDto } from './dto/test-provider.dto';
import { AiProbeService } from './ai-probe.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly llmFactory: LlmFactoryService,
    private readonly embeddingFactory: EmbeddingFactoryService,
    private readonly probe: AiProbeService,
  ) {}

  @Get('providers')
  @ApiOperation({
    summary: 'Liệt kê các provider LLM / embedding đã cấu hình (PROMPT §39)',
  })
  listProviders() {
    const embeddingCfg = this.config.get('embedding', { infer: true });
    return {
      llm: {
        active: this.llmFactory.defaultProviderName,
        providers: this.llmFactory.all().map((p) => ({
          provider: p.provider,
          defaultModel: p.defaultModel,
          configured: p.isConfigured(),
        })),
      },
      embedding: {
        active: this.embeddingFactory.defaultProviderName,
        dimension: embeddingCfg.dimension,
        batchSize: embeddingCfg.batchSize,
        providers: this.embeddingFactory.all().map((p) => ({
          provider: p.provider,
          defaultModel: p.defaultModel,
          configured: p.isConfigured(),
        })),
      },
    };
  }

  @Post('providers/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Kiểm tra kết nối thực tế tới một provider (PROMPT §39, §4.5)',
  })
  testProvider(@Body() dto: TestProviderDto) {
    return this.probe.test(dto);
  }
}
