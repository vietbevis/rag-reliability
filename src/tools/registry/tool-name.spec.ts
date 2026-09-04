import { specNameToToolId, toolIdToSpecName } from './tool-name';

describe('tool-name quy đổi', () => {
  it.each([
    ['rag.search', 'rag__search'],
    ['actvn-mcp.student_search', 'actvn-mcp__student_search'],
    ['calculator.calculate', 'calculator__calculate'],
    ['nodot', 'nodot'],
  ])('%s ↔ %s', (id, spec) => {
    expect(toolIdToSpecName(id)).toBe(spec);
    expect(specNameToToolId(spec)).toBe(id);
  });
});
