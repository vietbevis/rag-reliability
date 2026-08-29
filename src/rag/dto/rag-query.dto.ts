import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

class RetrievalFiltersDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sources?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean>;
}

export class RagQueryDto {
  @ApiPropertyOptional({ description: 'Câu hỏi' })
  @IsString()
  @MinLength(2)
  query!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;

  @ApiPropertyOptional({ type: RetrievalFiltersDto })
  @IsOptional()
  @IsObject()
  filters?: RetrievalFiltersDto;
}

export class RagSearchDto extends RagQueryDto {}
