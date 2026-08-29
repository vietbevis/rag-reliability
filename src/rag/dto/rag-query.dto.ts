import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ToBoolean } from '../../common/dto/boolean.transform';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const RETRIEVAL_STRATEGIES = [
  'vector',
  'keyword',
  'graph',
  'hybrid',
] as const;

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
  @ValidateNested()
  @Type(() => RetrievalFiltersDto)
  filters?: RetrievalFiltersDto;

  @ApiPropertyOptional({
    enum: RETRIEVAL_STRATEGIES,
    description:
      'Ghi đè RETRIEVAL_STRATEGY. hybrid = vector + keyword + graph rồi fusion.',
  })
  @IsOptional()
  @IsIn(RETRIEVAL_STRATEGIES)
  strategy?: (typeof RETRIEVAL_STRATEGIES)[number];

  @ApiPropertyOptional({
    description:
      'Ghi đè RERANK_ENABLED cho request này (benchmark before/after).',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  rerank?: boolean;
}

export class RagSearchDto extends RagQueryDto {}
