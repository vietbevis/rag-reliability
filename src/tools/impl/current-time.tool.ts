import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentTool,
  ToolExecutionContext,
  ToolResult,
} from '../core/tool.types';
import { localToolDefinition } from './local-tool.helpers';

const inputSchema = z.object({
  timezone: z
    .string()
    .trim()
    .optional()
    .describe('Múi giờ IANA, ví dụ "Asia/Ho_Chi_Minh". Bỏ trống = UTC.'),
});

const outputSchema = z.object({
  iso: z.string().describe('Thời điểm hiện tại dạng ISO-8601 (UTC).'),
  unixMs: z.number().int(),
  timezone: z.string(),
  localized: z
    .string()
    .describe('Chuỗi thời gian đọc được theo `timezone` yêu cầu.'),
});

type CurrentTimeInput = z.infer<typeof inputSchema>;
type CurrentTimeOutput = z.infer<typeof outputSchema>;

/**
 * Trả thời điểm hiện tại (PROMPT §9). Khử phi-xác định cho câu hỏi kiểu "gần
 * đây", "hôm nay", "còn mấy ngày". KHÔNG gọi LLM.
 */
@Injectable()
export class CurrentTimeTool implements AgentTool<
  CurrentTimeInput,
  CurrentTimeOutput
> {
  readonly definition = localToolDefinition({
    id: 'current_time.now',
    displayName: 'Current time',
    description:
      'Lấy ngày giờ hiện tại. Dùng khi câu hỏi phụ thuộc thời điểm hiện tại ' +
      '("hôm nay", "gần đây", "còn bao lâu nữa", tính tuổi/thời hạn…).',
    inputSchema,
    outputSchema,
    timeoutMs: 1000,
    tags: ['time', 'deterministic'],
  });

  execute(
    input: CurrentTimeInput,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult<CurrentTimeOutput>> {
    const now = new Date();
    const timezone = input.timezone || 'UTC';

    let localized: string;
    try {
      localized = new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(now);
    } catch {
      ctx.logger.debug(`current_time: timezone không hợp lệ "${timezone}"`);
      return Promise.resolve({
        success: false,
        error: {
          code: 'TOOL_ARGUMENT_ERROR',
          message: `Múi giờ không hợp lệ: "${timezone}". Dùng định danh IANA, ví dụ "Asia/Ho_Chi_Minh".`,
          retryable: false,
        },
        evidence: [],
      });
    }

    const data: CurrentTimeOutput = {
      iso: now.toISOString(),
      unixMs: now.getTime(),
      timezone,
      localized,
    };
    return Promise.resolve({
      success: true,
      data: outputSchema.parse(data),
      evidence: [
        {
          kind: 'computation',
          ref: 'current_time',
          text: `Thời điểm hiện tại: ${data.iso} (${timezone}: ${localized})`,
        },
      ],
    });
  }
}
