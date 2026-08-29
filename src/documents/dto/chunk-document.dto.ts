import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class ChunkDocumentDto {
  @ApiPropertyOptional({
    enum: ['structure', 'fixed', 'semantic'],
    description:
      'Ghi đè chiến lược chunking (mặc định lấy từ CHUNKING_STRATEGY)',
  })
  @IsOptional()
  @IsIn(['structure', 'fixed', 'semantic'])
  strategy?: 'structure' | 'fixed' | 'semantic';
}
