import { mockConfigService } from '../../config/config.mock';
import { LlmService } from '../../ai/llm/llm.service';
import {
  FakeLlmProvider,
  type FakeToolTurn,
} from '../../ai/llm/providers/fake-llm.provider';
import type {
  AnswerVerificationService,
  VerificationResult,
} from '../../rag/grounding/answer-verification.service';
import { CalculatorTool } from '../../tools/impl/calculator.tool';
import { CurrentTimeTool } from '../../tools/impl/current-time.tool';
import { makeTestRegistry } from '../../tools/testing/local-registry';
import { AgentGraphBuilder } from './agent-graph.builder';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

/**
 * AVS giả: `verifyAnswer` trả GROUNDED giữ nguyên câu trả lời;
 * `synthesizeAndVerify` trả câu tổng hợp từ số chunk nhận được.
 */
function stubVerification(): AnswerVerificationService {
  return {
    verifyAnswer: (answer: string): Promise<VerificationResult> =>
      Promise.resolve({
        answer,
        status: 'GROUNDED',
        claims: [],
        citations: [],
        faithfulness: { score: 1, grounded: true, claims: [] },
        usage: ZERO,
      }),
    synthesizeAndVerify: (
      _task: string,
      chunks: unknown[],
    ): Promise<VerificationResult> =>
      Promise.resolve({
        answer:
          chunks.length > 0
            ? `[tổng hợp từ ${chunks.length} evidence]`
            : 'Không tìm thấy thông tin đủ tin cậy trong knowledge base để trả lời câu hỏi này.',
        status: chunks.length > 0 ? 'GROUNDED' : 'INSUFFICIENT_EVIDENCE',
        claims: [],
        citations: [],
        faithfulness: { score: 1, grounded: true, claims: [] },
        usage: ZERO,
      }),
  } as unknown as AnswerVerificationService;
}

async function makeBuilder(env: Record<string, string> = {}) {
  const fake = new FakeLlmProvider();
  const registry = await makeTestRegistry({
    tools: [new CalculatorTool(), new CurrentTimeTool()],
  });
  const config = mockConfigService(
    {},
    {
      AGENT_ENABLED: 'true',
      AGENT_MAX_STEPS: '20',
      AGENT_MAX_TOOL_CALLS: '20',
      AGENT_LOOP_REPEAT_THRESHOLD: '2',
      ...env,
    },
  );
  const builder = new AgentGraphBuilder(
    fake as unknown as LlmService,
    registry,
    stubVerification(),
    config,
  );
  return {
    fake,
    builder,
    script: (turns: FakeToolTurn[]) => fake.scriptToolTurns(turns),
  };
}

const calc = (expression: string): FakeToolTurn => ({
  toolCalls: [{ name: 'calculator__calculate', args: { expression } }],
});

describe('AgentGraphBuilder.run', () => {
  it('trả lời thẳng khi model không gọi tool → đi qua finalize', async () => {
    const { builder, script } = await makeBuilder();
    script([{ content: 'Đáp án là 42.' }]);

    const out = await builder.run('6 nhân 7 bằng mấy?');

    expect(out.answer).toBe('Đáp án là 42.');
    expect(out.stopReason).toBe('final');
    expect(out.finalStatus).toBe('GROUNDED');
    expect(out.toolCallCount).toBe(0);
    expect(out.steps.map((s) => s.type)).toEqual(['THINK', 'FINAL']);
  });

  it('một vòng tool rồi chốt câu trả lời', async () => {
    const { builder, script } = await makeBuilder();
    script([calc('6*7'), { content: 'Kết quả là 42.' }]);

    const out = await builder.run('tính 6*7 giúp tôi');

    expect(out.answer).toBe('Kết quả là 42.');
    expect(out.stopReason).toBe('final');
    expect(out.finalStatus).toBe('GROUNDED');
    expect(out.toolCallCount).toBe(1);
    expect(out.steps.map((s) => s.type)).toEqual([
      'THINK',
      'TOOL_CALL',
      'TOOL_RESULT',
      'THINK',
      'FINAL',
    ]);
    expect(out.evidence).toEqual([
      expect.objectContaining({
        kind: 'computation',
        text: expect.any(String),
      }),
    ]);
    const toolResult = out.steps.find((s) => s.type === 'TOOL_RESULT');
    expect(toolResult?.toolOutput).toMatchObject({ result: '42' });
  });

  it('guard AGENT_MAX_STEPS: GUARD_STOP + finalize tổng hợp từ evidence đã có', async () => {
    const { builder, script } = await makeBuilder({ AGENT_MAX_STEPS: '3' });
    script([calc('1+1'), calc('2+2'), calc('3+3'), { content: 'xong' }]);

    const out = await builder.run('làm gì đó nhiều bước');

    expect(out.stopReason).toBe('budget_steps');
    expect(out.steps.some((s) => s.type === 'GUARD_STOP')).toBe(true);
    // finalize salvage được vì đã có evidence từ vòng tool đầu
    expect(out.answer).toContain('tổng hợp');
    expect(out.finalStatus).toBe('GROUNDED');
  });

  it('guard AGENT_MAX_TOOL_CALLS', async () => {
    const { builder, script } = await makeBuilder({
      AGENT_MAX_STEPS: '50',
      AGENT_MAX_TOOL_CALLS: '2',
      AGENT_LOOP_REPEAT_THRESHOLD: '10',
    });
    script([calc('1+1'), calc('2+2'), calc('3+3'), { content: 'xong' }]);

    const out = await builder.run('x');

    expect(out.stopReason).toBe('budget_tool_calls');
    expect(out.steps.some((s) => s.type === 'GUARD_STOP')).toBe(true);
  });

  it('loop-detector chặn lời gọi tool lặp lại y hệt', async () => {
    const { builder, script } = await makeBuilder({
      AGENT_MAX_STEPS: '50',
      AGENT_LOOP_REPEAT_THRESHOLD: '1',
    });
    script([calc('1+1'), calc('1+1'), { content: 'câu cuối là 2' }]);

    const out = await builder.run('x');

    expect(out.answer).toBe('câu cuối là 2');
    const toolResults = out.steps.filter((s) => s.type === 'TOOL_RESULT');
    expect(toolResults[0]?.error).toBeUndefined();
    expect(toolResults[1]?.note).toMatch(/loop-detector/);
    expect(toolResults[1]?.error).toMatch(/đã chạy/);
  });

  it('no_progress: dừng sau nhiều vòng không sinh evidence mới', async () => {
    const { builder, script } = await makeBuilder({
      AGENT_MAX_STEPS: '50',
      AGENT_LOOP_REPEAT_THRESHOLD: '1',
    });
    script([calc('1+1'), calc('1+1'), calc('1+1'), calc('1+1'), calc('1+1')]);

    const out = await builder.run('x');

    expect(out.stopReason).toBe('no_progress');
    expect(out.steps.some((s) => s.type === 'GUARD_STOP')).toBe(true);
  });

  it('args tool sai schema → tool trả lỗi, model xoay hướng ở lượt sau', async () => {
    const { builder, script } = await makeBuilder();
    script([
      {
        toolCalls: [
          { name: 'calculator__calculate', args: { expression: 123 } },
        ],
      },
      { content: 'đã sửa, kết quả 5' },
    ]);

    const out = await builder.run('x');

    expect(out.answer).toBe('đã sửa, kết quả 5');
    const toolResult = out.steps.find((s) => s.type === 'TOOL_RESULT');
    expect(toolResult?.error).toMatch(/không hợp lệ/);
    expect(out.evidence).toHaveLength(0);
  });

  it('nhiều tool trong một lượt', async () => {
    const { builder, script } = await makeBuilder();
    script([
      {
        toolCalls: [
          { name: 'calculator__calculate', args: { expression: '10*10' } },
          { name: 'current_time__now', args: {} },
        ],
      },
      { content: 'xong cả hai' },
    ]);

    const out = await builder.run('x');

    expect(out.toolCallCount).toBe(2);
    expect(out.evidence).toHaveLength(2);
    expect(out.steps.filter((s) => s.type === 'TOOL_RESULT')).toHaveLength(2);
  });
});
