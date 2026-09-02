import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const AGENT_EXECUTION_MODES = ['sync', 'async'] as const;

export class RunAgentDto {
  @ApiProperty({ description: 'Yêu cầu / câu hỏi cho agent.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  task!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Giới hạn tool agent được dùng (tên snake_case). Bỏ trống = tất cả tool read.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  toolAllowlist?: string[];

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    description: 'Ghi đè AGENT_COST_BUDGET_USD cho run này.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  costBudgetUsd?: number;

  @ApiPropertyOptional({
    enum: AGENT_EXECUTION_MODES,
    description: "17.7: chỉ 'sync' được hỗ trợ; 'async' (BullMQ) ở 17.8.",
  })
  @IsOptional()
  @IsIn(AGENT_EXECUTION_MODES)
  execution?: (typeof AGENT_EXECUTION_MODES)[number];
}
