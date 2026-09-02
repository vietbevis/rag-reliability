import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Observable, interval } from 'rxjs';
import { AgentEnabledGuard } from './agent-enabled.guard';
import { AgentService } from './agent.service';
import { AgentQueueService } from './queue/agent-queue.service';
import { RunAgentDto } from './dto/run-agent.dto';

const STREAM_POLL_MS = 700;
const STREAM_MAX_MS = 5 * 60 * 1000;

/**
 * HTTP cho agent (PHASE 17 §11). 17.7 sync · 17.8 async BullMQ + `/cancel` +
 * SSE `/stream`. Toàn bộ route qua {@link AgentEnabledGuard} + throttler `agent`.
 */
@ApiTags('agent')
@Controller('agent')
@UseGuards(AgentEnabledGuard)
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly queue: AgentQueueService,
  ) {}

  @Post('run')
  @HttpCode(200)
  @Throttle({ agent: {} })
  @ApiOperation({
    summary:
      "Chạy agent. execution='sync' (mặc định) → 200 + kết quả; 'async' → 202 " +
      '(khi QUEUE_ENABLED) rồi theo dõi qua /stream hoặc /runs/:id.',
  })
  async run(
    @Body() dto: RunAgentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, queued } = await this.queue.submit(
      dto.task,
      { toolAllowlist: dto.toolAllowlist, costBudgetUsd: dto.costBudgetUsd },
      dto.execution ?? 'sync',
    );
    if (queued) {
      res.status(202);
      return queued;
    }
    return result;
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Kết quả / trạng thái một agent run.' })
  get(@Param('id') id: string) {
    return this.agent.get(id);
  }

  @Get('runs/:id/trace')
  @ApiOperation({ summary: 'Trajectory đầy đủ (đã khử secret/PII).' })
  trace(@Param('id') id: string) {
    return this.agent.getTrace(id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Huỷ một run đang chạy.' })
  cancel(@Param('id') id: string) {
    return this.agent.cancel(id);
  }

  @Sse('runs/:id/stream')
  @ApiOperation({
    summary: 'SSE: đẩy từng step khi phát sinh; đóng khi run kết thúc.',
  })
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let lastIndex = -1;
      let stopped = false;
      const startedAt = Date.now();

      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          const steps = await this.agent.stepsSince(id, lastIndex);
          for (const s of steps) {
            lastIndex = s.index;
            subscriber.next({ type: 'step', data: s });
          }
          const status = await this.agent.statusOf(id);
          if (status === null) {
            subscriber.next({
              type: 'error',
              data: { message: 'run không tồn tại' },
            });
            finish();
            return;
          }
          if (status !== 'RUNNING' || Date.now() - startedAt > STREAM_MAX_MS) {
            subscriber.next({ type: 'done', data: { status } });
            finish();
          }
        } catch (err) {
          subscriber.next({
            type: 'error',
            data: { message: err instanceof Error ? err.message : 'lỗi' },
          });
          finish();
        }
      };

      const finish = (): void => {
        stopped = true;
        sub.unsubscribe();
        subscriber.complete();
      };

      const sub = interval(STREAM_POLL_MS).subscribe(() => void tick());
      void tick();

      return () => {
        stopped = true;
        sub.unsubscribe();
      };
    });
  }
}
