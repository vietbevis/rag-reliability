import { z } from 'zod';
import { CustomLlmProvider } from '../src/ai/llm/providers/custom-llm.provider';
import type { ToolSpec } from '../src/ai/llm/llm.interface';
import { mockConfigService } from '../src/config/config.mock';

/**
 * PHASE 17.1 — verify provider LLM bên thứ 3 (api.b.ai, cấu hình `custom`) trả
 * `tool_calls` đúng chuẩn OpenAI khi bind tool. Gọi mạng THẬT nên chỉ chạy khi
 * operator bật rõ ràng:
 *
 *   AGENT_LLM_TOOLS_LIVE=1 npm run test:e2e -- agent-llm-tools
 *
 * `jest-e2e.setup` ép `LLM_PROVIDER=fake`; test này dựng `CustomLlmProvider`
 * trực tiếp từ `CUSTOM_LLM_*` trong `.env` (đã nạp qua dotenv).
 */
const RUN =
  process.env.AGENT_LLM_TOOLS_LIVE === '1' &&
  !!process.env.CUSTOM_LLM_BASE_URL &&
  !!process.env.CUSTOM_LLM_MODEL;

const weatherTool: ToolSpec = {
  name: 'get_weather',
  description:
    'Lấy thời tiết hiện tại của một thành phố. Dùng khi người dùng hỏi về thời tiết.',
  parameters: z.object({
    city: z.string().describe('Tên thành phố cần tra thời tiết'),
  }),
};

(RUN ? describe : describe.skip)(
  'CustomLlmProvider.chatWithTools — LIVE (api.b.ai)',
  () => {
    const provider = new CustomLlmProvider(
      mockConfigService(
        {},
        {
          LLM_PROVIDER: 'custom',
          CUSTOM_LLM_BASE_URL: process.env.CUSTOM_LLM_BASE_URL as string,
          CUSTOM_LLM_API_KEY: process.env.CUSTOM_LLM_API_KEY ?? '',
          CUSTOM_LLM_MODEL:
            process.env.AGENT_MODEL || (process.env.CUSTOM_LLM_MODEL as string),
          EMBEDDING_PROVIDER: 'custom',
          CUSTOM_EMBEDDING_BASE_URL: process.env.CUSTOM_LLM_BASE_URL as string,
          CUSTOM_EMBEDDING_MODEL: 'e5',
        },
      ),
    );

    it('supportsNativeToolCalling = true', () => {
      expect(provider.supportsNativeToolCalling()).toBe(true);
    });

    it('trả về tool_call hợp lệ khi câu hỏi cần tool', async () => {
      const res = await provider.chatWithTools(
        [{ role: 'user', content: 'Thời tiết ở Hà Nội hôm nay thế nào?' }],
        [weatherTool],
        { timeoutMs: 30_000 },
      );

      expect(res.toolCalls.length).toBeGreaterThan(0);
      const call = res.toolCalls[0]!;
      expect(call.name).toBe('get_weather');
      expect(call.argsValid).toBe(true);
      expect(
        String((call.args as { city: string }).city).toLowerCase(),
      ).toContain('nội');
    }, 45_000);

    it('trả lời thẳng (không tool_call) khi không cần tool', async () => {
      const res = await provider.chatWithTools(
        [{ role: 'user', content: 'Chào bạn, 2 cộng 2 bằng mấy?' }],
        [weatherTool],
        { timeoutMs: 30_000 },
      );

      expect(res.toolCalls).toHaveLength(0);
      expect(res.content).toMatch(/4|bốn/i);
    }, 45_000);

    it('lượt nối tiếp: nhận ToolMessage rồi chốt câu trả lời', async () => {
      const res = await provider.chatWithTools(
        [
          { role: 'user', content: 'Thời tiết ở Hà Nội hôm nay thế nào?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                name: 'get_weather',
                args: { city: 'Hà Nội' },
                argsValid: true,
              },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call_1',
            name: 'get_weather',
            content: JSON.stringify({ city: 'Hà Nội', tempC: 30, sky: 'nắng' }),
          },
        ],
        [weatherTool],
        { timeoutMs: 30_000 },
      );

      expect(res.toolCalls).toHaveLength(0);
      expect(res.content).toMatch(/30|nắng/i);
    }, 45_000);
  },
);
