import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class ChunkDocumentDto {
  @ApiPropertyOptional({
    enum: ['structure', 'fixed'],
    description:
      'Ghi đè chiến lược chunking (mặc định lấy từ CHUNKING_STRATEGY)',
  })
  @IsOptional()
  @IsIn(['structure', 'fixed'])
  strategy?: 'structure' | 'fixed';
}
