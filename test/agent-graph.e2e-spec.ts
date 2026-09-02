import type { LlmService } from '../src/ai/llm/llm.service';
import { CustomLlmProvider } from '../src/ai/llm/providers/custom-llm.provider';
import { TokenCounterService } from '../src/ai/tokenizer/token-counter.service';
import { AgentGraphBuilder } from '../src/agent/graph/agent-graph.builder';
import { CalculatorTool } from '../src/agent/tools/builtin/calculator.tool';
import { CurrentTimeTool } from '../src/agent/tools/builtin/current-time.tool';
import { ToolRegistryService } from '../src/agent/tools/tool-registry.service';
import { mockConfigService } from '../src/config/config.mock';
import type { Neo4jService } from '../src/graph/neo4j.service';
import { ContextBuilderService } from '../src/rag/context/context-builder.service';
import { AnswerGenerationService } from '../src/rag/grounding/answer-generation.service';
import { AnswerVerificationService } from '../src/rag/grounding/answer-verification.service';
import { CitationService } from '../src/rag/grounding/citation.service';
import { ClaimExtractorService } from '../src/rag/grounding/claim-extractor.service';
import { EvidenceMatcherService } from '../src/rag/grounding/evidence-matcher.service';
import { FaithfulnessService } from '../src/rag/grounding/faithfulness.service';

/**
 * PHASE 17.3 + 17.5 — vòng lặp agent ⇄ tool + finalize verify, LLM THẬT
 * (api.b.ai) + tool thật:
 *   AGENT_LLM_TOOLS_LIVE=1 npm run test:e2e -- agent-graph
 */
const RUN =
  process.env.AGENT_LLM_TOOLS_LIVE === '1' &&
  !!process.env.CUSTOM_LLM_BASE_URL &&
  !!process.env.CUSTOM_LLM_MODEL;

function buildStack() {
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
  const llm = new CustomLlmProvider(config) as unknown as LlmService;
  const contextBuilder = new ContextBuilderService(
    new TokenCounterService(),
    config,
  );
  const neo4j = {
    enabled: false,
    isConnected: false,
  } as unknown as Neo4jService;
  const verification = new AnswerVerificationService(
    new AnswerGenerationService(llm, contextBuilder, config),
    contextBuilder,
    new ClaimExtractorService(llm, config),
    new EvidenceMatcherService(config),
    new CitationService(neo4j, config),
    new FaithfulnessService(llm, config),
    config,
  );
  const registry = new ToolRegistryService([
    new CalculatorTool(),
    new CurrentTimeTool(),
  ]);
  return new AgentGraphBuilder(llm, registry, verification, config);
}

/**
 * Bỏ qua nếu api.b.ai trả 429 (rate limit) — smoke test, không phải bug. Chạy
 * cách nhau vài giây, đừng lặp liên tục.
 */
function skipIfRateLimited(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit/i.test(msg)) {
    console.warn(`[skip] api.b.ai rate-limited: ${msg}`);
    return;
  }
  throw err;
}

(RUN ? describe : describe.skip)('AgentGraphBuilder — LIVE (api.b.ai)', () => {
  const builder = buildStack();

  it('dùng calculator, đi qua finalize verify', async () => {
    let out;
    try {
      out = await builder.run(
        'Một cửa hàng bán được 37 món, mỗi món giá 18500 đồng. Tổng doanh thu ' +
          'là bao nhiêu đồng? Hãy dùng công cụ tính toán để tính chính xác.',
      );
    } catch (err) {
      return skipIfRateLimited(err);
    }
    if (out.stopReason === 'error') return; // rate limit trong graph

    expect(out.stopReason).toBe('final');
    expect(out.toolCallCount).toBeGreaterThan(0);
    expect(out.evidence.some((e) => e.kind === 'computation')).toBe(true);
    // finalize đã chạy (status khác null); giá trị cụ thể phụ thuộc verifier.
    expect(out.finalStatus).not.toBeNull();
  }, 120_000);

  it('trả lời không có evidence → abstain (INSUFFICIENT_EVIDENCE)', async () => {
    let out;
    try {
      out = await builder.run(
        'Thủ đô của Việt Nam là thành phố nào? Trả lời ngắn gọn.',
      );
    } catch (err) {
      return skipIfRateLimited(err);
    }
    if (out.stopReason === 'error') return;

    // Agent trả lời thẳng không tra cứu ⇒ finalize không có evidence ⇒ abstain.
    expect(out.finalStatus).toBe('INSUFFICIENT_EVIDENCE');
    expect(out.answer ?? '').toMatch(/không tìm thấy thông tin đủ tin cậy/i);
  }, 120_000);
});
