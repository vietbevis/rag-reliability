import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentEnabledGuard } from './agent-enabled.guard';
import { AgentService } from './agent.service';
import { RunAgentDto } from './dto/run-agent.dto';

/**
 * HTTP cho agent (PHASE 17 §11). 17.7: chỉ chạy đồng bộ. `execution:'async'`
 * (BullMQ), `/stream` (SSE), `/cancel` ở 17.8. Toàn bộ route qua
 * {@link AgentEnabledGuard} + throttler `agent` (chặt nhất).
 */
@ApiTags('agent')
@Controller('agent')
@UseGuards(AgentEnabledGuard)
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('run')
  @HttpCode(200)
  @Throttle({ agent: {} })
  @ApiOperation({
    summary: 'Chạy agent đồng bộ: task → vòng lặp tool → finalize verify.',
  })
  run(@Body() dto: RunAgentDto) {
    if (dto.execution === 'async') {
      throw new BadRequestException(
        "execution:'async' chưa hỗ trợ (PHASE 17.8). Dùng 'sync'.",
      );
    }
    return this.agent.run(dto.task, {
      toolAllowlist: dto.toolAllowlist,
      costBudgetUsd: dto.costBudgetUsd,
    });
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Kết quả một agent run.' })
  get(@Param('id') id: string) {
    return this.agent.get(id);
  }

  @Get('runs/:id/trace')
  @ApiOperation({ summary: 'Trajectory đầy đủ (đã khử secret/PII).' })
  trace(@Param('id') id: string) {
    return this.agent.getTrace(id);
  }
}
