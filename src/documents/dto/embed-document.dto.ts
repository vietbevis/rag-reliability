import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class EmbedDocumentDto {
  @ApiPropertyOptional({
    enum: ['openai', 'gemini', 'custom', 'fake'],
    description:
      'Ghi đè provider embedding (mặc định lấy từ EMBEDDING_PROVIDER)',
  })
  @IsOptional()
  @IsIn(['openai', 'gemini', 'custom', 'fake'])
  provider?: 'openai' | 'gemini' | 'custom' | 'fake';
}
