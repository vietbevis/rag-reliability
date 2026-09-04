import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentEnabledGuard } from '../agent/agent-enabled.guard';
import { ReplayService } from './replay.service';
import type { ReplayMode } from './replay-tool.provider';

/**
 * HTTP cho replay một `AgentRun` đã ghi (target-state.md §11). Gate cùng
 * `AGENT_ENABLED` như các route agent khác.
 */
@ApiTags('agent')
@Controller('agent/runs')
@UseGuards(AgentEnabledGuard)
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  @Post(':id/replay')
  @ApiOperation({
    summary:
      'Replay một AgentRun đã ghi. mode: recorded (mặc định) | dry-run | ' +
      'live-read. Tool side-effecting KHÔNG bao giờ blind replay.',
  })
  run(@Param('id') id: string, @Body() body: { mode?: ReplayMode }) {
    return this.replay.replay(id, body?.mode ?? 'recorded');
  }
}
