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
}

/**
 * Body cho `POST /evaluation/benchmark-rerank`. LUÔN chạy `mode: 'full'` — rerank
 * chỉ tác động trong pipeline generation, `mode: 'retrieval'` sẽ cho deltas = 0.
 */
export class BenchmarkRerankDto {
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
