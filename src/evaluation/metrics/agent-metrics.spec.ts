import {
  abstentionCorrect,
  forbiddenToolCompliance,
  formatValidity,
  scoreAgentCase,
  stepEfficiency,
  toolSelection,
  type AgentTrajectory,
} from './agent-metrics';

const traj = (over: Partial<AgentTrajectory> = {}): AgentTrajectory => ({
  toolsUsed: [],
  stepCount: 2,
  toolCallCount: 0,
  finalStatus: 'GROUNDED',
  answer: 'đáp án',
  formatValid: 0,
  formatTotal: 0,
  ...over,
});

describe('toolSelection', () => {
  it('khớp hoàn toàn → P/R/F1 = 1', () => {
    expect(toolSelection(['rag_search'], ['rag_search'])).toEqual({
      precision: 1,
      recall: 1,
      f1: 1,
    });
  });

  it('expected rỗng + không dùng tool → precision 1', () => {
    expect(toolSelection([], []).precision).toBe(1);
  });

  it('expected rỗng nhưng dùng tool thừa → precision 0', () => {
    expect(toolSelection(['calculator'], []).precision).toBe(0);
  });

  it('dùng đúng 1/2 tool cần → recall 0.5', () => {
    const r = toolSelection(['rag_search'], ['rag_search', 'graph_query']);
    expect(r.recall).toBe(0.5);
    expect(r.precision).toBe(1);
  });

  it('dùng tool thừa → precision < 1', () => {
    const r = toolSelection(['rag_search', 'calculator'], ['rag_search']);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(1);
  });
});

describe('forbiddenToolCompliance', () => {
  it('không gọi tool cấm → 1', () => {
    expect(forbiddenToolCompliance(['rag_search'], ['calculator'])).toBe(1);
  });
  it('gọi tool cấm → 0', () => {
    expect(forbiddenToolCompliance(['calculator'], ['calculator'])).toBe(0);
  });
});

describe('abstentionCorrect', () => {
  it('phải abstain + đã abstain → 1', () => {
    expect(abstentionCorrect('INSUFFICIENT_EVIDENCE', true)).toBe(1);
  });
  it('phải abstain nhưng trả lời → 0', () => {
    expect(abstentionCorrect('GROUNDED', true)).toBe(0);
  });
  it('không cần abstain + trả lời → 1', () => {
    expect(abstentionCorrect('GROUNDED', false)).toBe(1);
  });
  it('không cần abstain nhưng abstain → 0', () => {
    expect(abstentionCorrect('INSUFFICIENT_EVIDENCE', false)).toBe(0);
  });
});

describe('stepEfficiency', () => {
  it('không thừa bước → 1', () => {
    expect(stepEfficiency(3, 3)).toBe(1);
  });
  it('thừa bước → < 1', () => {
    expect(stepEfficiency(6, 3)).toBe(0.5);
  });
  it('không có minSteps → 1', () => {
    expect(stepEfficiency(10)).toBe(1);
  });
});

describe('formatValidity', () => {
  it('không tool call → 1', () => {
    expect(formatValidity(0, 0)).toBe(1);
  });
  it('2/3 hợp lệ → 0.667', () => {
    expect(formatValidity(2, 3)).toBeCloseTo(0.667, 2);
  });
});

describe('scoreAgentCase', () => {
  it('mọi thứ đúng → pass, score cao', () => {
    const s = scoreAgentCase(
      traj({
        toolsUsed: ['rag_search'],
        stepCount: 4,
        formatValid: 1,
        formatTotal: 1,
      }),
      { expectedTools: ['rag_search'], minSteps: 4 },
    );
    expect(s.pass).toBe(true);
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.reasons).toHaveLength(0);
  });

  it('gọi tool cấm → fail + reason', () => {
    const s = scoreAgentCase(traj({ toolsUsed: ['calculator'] }), {
      forbiddenTools: ['calculator'],
    });
    expect(s.pass).toBe(false);
    expect(s.reasons).toContain('gọi tool bị cấm');
  });

  it('đáng lẽ abstain mà trả lời → fail', () => {
    const s = scoreAgentCase(traj({ finalStatus: 'GROUNDED' }), {
      mustAbstain: true,
    });
    expect(s.pass).toBe(false);
    expect(s.reasons).toContain('đáng lẽ phải abstain');
  });

  it('format-validity thấp → fail', () => {
    const s = scoreAgentCase(traj({ formatValid: 1, formatTotal: 3 }), {});
    expect(s.pass).toBe(false);
  });
});
