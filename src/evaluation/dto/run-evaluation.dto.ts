import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ToBoolean } from '../../common/dto/boolean.transform';

/** Body cho `POST /evaluation/run` (PROMPT §31). */
export class RunEvaluationDto {
  @ApiProperty({ description: 'Tên dataset = tên file .jsonl không đuôi' })
  @IsString()
  @MinLength(1)
  datasetName!: string;

  @ApiPropertyOptional({ description: 'Nhãn cho run; tự sinh nếu bỏ trống' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({
    enum: ['retrieval', 'full'],
    default: 'full',
    description: '`retrieval` chỉ đo truy hồi, không gọi LLM sinh câu trả lời',
  })
  @IsOptional()
  @IsIn(['retrieval', 'full'])
  mode?: 'retrieval' | 'full';

  @ApiPropertyOptional({ description: 'Đánh dấu run này là baseline' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isBaseline?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;

  @ApiPropertyOptional({
    description:
      'Ghi đè RERANK_ENABLED cho run này (§36 benchmark before/after)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  rerank?: boolean;

  @ApiPropertyOptional({
    description: 'Ghi đè RAG_STRICT_GROUNDING cho run này (§36)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  strict?: boolean;

  @ApiPropertyOptional({
    description: 'Ghi đè RAG_CITATION_ENABLED cho run này (§36)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  cite?: boolean;

  @ApiPropertyOptional({
    description: 'Ghi đè RAG_FAITHFULNESS_ENABLED cho run này (§36)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  faithfulness?: boolean;
}

/**
 * Body cho `POST /evaluation/benchmark-rerank` và `.../benchmark-grounding`.
 * LUÔN chạy `mode: 'full'` — biến thể chỉ tác động ở pipeline generation.
 */
export class BenchmarkVariantDto {
  @ApiProperty({ description: 'Tên dataset' })
  @IsString()
  @MinLength(1)
  datasetName!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;
}

/** Body cho `POST /evaluation/experiments/run` (PROMPT §36). */
export class RunExperimentDto {
  @ApiProperty({
    description:
      'Mã experiment (ví dụ: exp-001, exp-002, exp-003, exp-004, exp-005, exp-007)',
    example: 'exp-003',
  })
  @IsString()
  @MinLength(1)
  experimentId!: string;

  @ApiPropertyOptional({
    description: 'Tên dataset (nếu không truyền sẽ dùng default của experiment)',
  })
  @IsOptional()
  @IsString()
  datasetName?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;
}

/** Body cho `POST /evaluation/benchmark-strategies` (PHASE 13). */
export class BenchmarkStrategiesDto {
  @ApiProperty({ description: 'Tên dataset để so sánh các chiến lược' })
  @IsString()
  @MinLength(1)
  datasetName!: string;

  @ApiPropertyOptional({
    enum: ['retrieval', 'full'],
    default: 'retrieval',
    description: 'Chế độ đánh giá: chỉ retrieval hoặc full pipeline',
  })
  @IsOptional()
  @IsIn(['retrieval', 'full'])
  mode?: 'retrieval' | 'full';

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;
}

/** Body cho `POST /evaluation/benchmark-providers` (PHASE 13). */
export class BenchmarkProvidersDto {
  @ApiProperty({ description: 'Tên dataset để benchmark provider' })
  @IsString()
  @MinLength(1)
  datasetName!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  topK?: number;
}
