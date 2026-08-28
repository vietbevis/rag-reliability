import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { LlmProvider } from '../llm/llm-provider.enum';

export class TestProviderDto {
  @ApiProperty({ enum: LlmProvider, description: 'Provider cần kiểm tra' })
  @IsEnum(LlmProvider)
  provider!: LlmProvider;

  @ApiPropertyOptional({
    enum: ['chat', 'embedding'],
    default: 'chat',
    description: 'Khả năng cần probe',
  })
  @IsOptional()
  @IsIn(['chat', 'embedding'])
  mode?: 'chat' | 'embedding';

  @ApiPropertyOptional({ description: 'Ghi đè model dùng để probe' })
  @IsOptional()
  @IsString()
  model?: string;
}
