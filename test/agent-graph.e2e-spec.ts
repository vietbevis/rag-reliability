import { LlmService } from '../src/ai/llm/llm.service';
import { CustomLlmProvider } from '../src/ai/llm/providers/custom-llm.provider';
import { AgentGraphBuilder } from '../src/agent/graph/agent-graph.builder';
import { CalculatorTool } from '../src/agent/tools/builtin/calculator.tool';
import { CurrentTimeTool } from '../src/agent/tools/builtin/current-time.tool';
import { ToolRegistryService } from '../src/agent/tools/tool-registry.service';
import { mockConfigService } from '../src/config/config.mock';

/**
 * PHASE 17.3 — chạy vòng lặp agent ⇄ tool với LLM THẬT (api.b.ai) + tool thật.
 * Gated:
 *   AGENT_LLM_TOOLS_LIVE=1 npm run test:e2e -- agent-graph
 */
const RUN =
  process.env.AGENT_LLM_TOOLS_LIVE === '1' &&
  !!process.env.CUSTOM_LLM_BASE_URL &&
  !!process.env.CUSTOM_LLM_MODEL;

(RUN ? describe : describe.skip)('AgentGraphBuilder — LIVE (api.b.ai)', () => {
  const config = mockConfigService(
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
      AGENT_ENABLED: 'true',
      AGENT_MAX_STEPS: '12',
    },
  );

  const builder = new AgentGraphBuilder(
    new CustomLlmProvider(config) as unknown as LlmService,
    new ToolRegistryService([new CalculatorTool(), new CurrentTimeTool()]),
    config,
  );

  it('dùng calculator để trả lời bài toán nhiều chữ số', async () => {
    const out = await builder.run(
      'Một cửa hàng bán được 37 món, mỗi món giá 18500 đồng. Tổng doanh thu là ' +
        'bao nhiêu đồng? Hãy dùng công cụ tính toán để tính chính xác.',
    );

    expect(out.stopReason).toBe('final');
    expect(out.toolCallCount).toBeGreaterThan(0);
    expect(out.evidence.some((e) => e.kind === 'computation')).toBe(true);
    expect(out.answer ?? '').toMatch(/684[.,\s]?500/);
  }, 90_000);

  it('trả lời thẳng câu hỏi không cần tool', async () => {
    const out = await builder.run(
      'Thủ đô của Việt Nam là thành phố nào? Trả lời ngắn gọn.',
    );

    expect(out.stopReason).toBe('final');
    expect(out.answer ?? '').toMatch(/Hà Nội/i);
  }, 90_000);
});
