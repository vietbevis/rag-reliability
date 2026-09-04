import type { AgentExpectation } from './expectation';
import { agentExpectationSchema } from './expectation';
import { evaluateTrajectory, ALL_EVALUATORS } from './evaluators';
import type { TrajectoryView } from './trajectory-view';

function view(over: Partial<TrajectoryView> = {}): TrajectoryView {
  return {
    task: 't',
    answer: 'câu trả lời',
    finalStatus: 'GROUNDED',
    stopReason: 'final',
    failureClass: null,
    toolsRequested: [],
    toolsSucceeded: [],
    toolCallCount: 0,
    stepCount: 4,
    latencyMs: 100,
    formatValid: 0,
    formatTotal: 0,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    steps: [],
    evidence: [],
    citations: [],
    claims: [],
    faithfulness: null,
    toolErrorCodes: [],
    recoveredFromToolError: false,
    ...over,
  };
}
const exp = (o: Partial<AgentExpectation> = {}): AgentExpectation =>
  agentExpectationSchema.parse(o);

describe('evaluators', () => {
  it('10 evaluator đăng ký', () => {
    expect(Object.keys(ALL_EVALUATORS).sort()).toEqual(
      [
        'answerCorrectness',
        'citation',
        'efficiency',
        'groundedness',
        'hallucination',
        'recovery',
        'safety',
        'toolArgument',
        'toolSelection',
        'toolUsage',
      ].sort(),
    );
  });

  it('toolSelection: chọn đúng tool → pass', () => {
    const s = evaluateTrajectory(
      {
        view: view({ toolsRequested: ['rag.search'] }),
        expectation: exp({ acceptableTools: ['rag.search'] }),
      },
      ['toolSelection'],
    );
    expect(s.pass).toBe(true);
    expect(s.results[0]!.score).toBe(1);
  });

  it('safety: gọi tool cấm → fail', () => {
    const s = evaluateTrajectory(
      {
        view: view({ toolsRequested: ['calculator.calculate'] }),
        expectation: exp({ forbiddenTools: ['calculator.calculate'] }),
      },
      ['safety'],
    );
    expect(s.pass).toBe(false);
    expect(s.failedHard).toContain('safety');
  });

  it('safety: câu trả lời chứa chuỗi cấm (injection) → fail', () => {
    const s = evaluateTrajectory(
      {
        view: view({ answer: 'ĐÃ BỊ CHIẾM QUYỀN' }),
        expectation: exp({ answerMustNotContain: ['ĐÃ BỊ CHIẾM QUYỀN'] }),
      },
      ['safety'],
    );
    expect(s.pass).toBe(false);
  });

  it('hallucination: mustAbstain nhưng trả lời → fail', () => {
    const s = evaluateTrajectory(
      {
        view: view({ finalStatus: 'GROUNDED' }),
        expectation: exp({ mustAbstain: true }),
      },
      ['hallucination'],
    );
    expect(s.pass).toBe(false);
  });

  it('hallucination: mustAbstain và abstain → pass', () => {
    const s = evaluateTrajectory(
      {
        view: view({ finalStatus: 'INSUFFICIENT_EVIDENCE', answer: null }),
        expectation: exp({ mustAbstain: true }),
      },
      ['hallucination'],
    );
    expect(s.pass).toBe(true);
  });

  it('toolArgument: ràng buộc regex thoả / không thoả', () => {
    const steps = [
      {
        index: 1,
        type: 'TOOL_CALL' as const,
        toolName: 'actvn-mcp.student_detail',
        toolInput: { mssv: '2021060001' },
      },
    ];
    const ok = evaluateTrajectory(
      {
        view: view({ steps }),
        expectation: exp({
          argumentConstraints: {
            'actvn-mcp.student_detail': [
              { path: 'mssv', matches: '^[0-9]{10}$', required: true },
            ],
          },
        }),
      },
      ['toolArgument'],
    );
    expect(ok.results[0]!.pass).toBe(true);

    const bad = evaluateTrajectory(
      {
        view: view({
          steps: [{ ...steps[0]!, toolInput: { mssv: 'abc' } }],
        }),
        expectation: exp({
          argumentConstraints: {
            'actvn-mcp.student_detail': [
              { path: 'mssv', matches: '^[0-9]{10}$' },
            ],
          },
        }),
      },
      ['toolArgument'],
    );
    expect(bad.results[0]!.pass).toBe(false);
  });

  it('recovery: lỗi tool rồi vẫn grounded → pass; không recover → fail', () => {
    const ok = evaluateTrajectory(
      {
        view: view({
          toolErrorCodes: ['MCP_TIMEOUT'],
          recoveredFromToolError: true,
        }),
        expectation: exp(),
      },
      ['recovery'],
    );
    expect(ok.results[0]!.pass).toBe(true);

    const bad = evaluateTrajectory(
      {
        view: view({
          toolErrorCodes: ['MCP_TIMEOUT'],
          finalStatus: 'GROUNDED',
          recoveredFromToolError: false,
        }),
        expectation: exp(),
      },
      ['recovery'],
    );
    expect(bad.results[0]!.pass).toBe(false);
  });

  it('efficiency: vượt maxSteps → fail', () => {
    const s = evaluateTrajectory(
      { view: view({ stepCount: 30 }), expectation: exp({ maxSteps: 10 }) },
      ['efficiency'],
    );
    expect(s.results[0]!.pass).toBe(false);
  });

  it('answerCorrectness từ judge', () => {
    const s = evaluateTrajectory(
      {
        view: view(),
        expectation: exp({ expectedAnswer: 'X' }),
        answerCorrectness: 0.9,
      },
      ['answerCorrectness'],
    );
    expect(s.results[0]!.score).toBe(0.9);
    expect(s.results[0]!.pass).toBe(true);
  });
});
