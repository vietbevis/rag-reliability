import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
} from '../tool.interface';

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
 * Trả thời điểm hiện tại (PHASE 17 §7). Khử phi-xác định cho câu hỏi kiểu "gần
 * đây", "hôm nay", "còn mấy ngày" — LLM không tự biết ngày giờ thực. KHÔNG gọi
 * LLM. Cùng một thời điểm gọi ⇒ cùng kết quả (không cache, đọc `Date.now()`).
 */
@Injectable()
export class CurrentTimeTool implements AgentTool<
  CurrentTimeInput,
  CurrentTimeOutput
> {
  readonly name = 'current_time';
  readonly description =
    'Lấy ngày giờ hiện tại. Dùng khi câu hỏi phụ thuộc thời điểm hiện tại ' +
    '("hôm nay", "gần đây", "còn bao lâu nữa", tính tuổi/thời hạn…).';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly timeoutMs = 1000;
  readonly maxRetries = 0;

  execute(
    input: CurrentTimeInput,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult<CurrentTimeOutput>> {
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
        ok: false,
        data: { iso: '', unixMs: 0, timezone, localized: '' },
        evidence: [],
        error: `Múi giờ không hợp lệ: "${timezone}". Dùng định danh IANA, ví dụ "Asia/Ho_Chi_Minh".`,
      });
    }

    const data: CurrentTimeOutput = {
      iso: now.toISOString(),
      unixMs: now.getTime(),
      timezone,
      localized,
    };
    return Promise.resolve({
      ok: true,
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
