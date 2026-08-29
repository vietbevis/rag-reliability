import { mockConfigService } from '../../config/config.mock';
import { LlmService } from '../../ai/llm/llm.service';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphEntityLinkerService } from './graph-entity-linker.service';

function build(
  opts: {
    substringRows?: Array<{ key: string; name: string }>;
    llmEntities?: string[];
    llmMatchRows?: Array<{ key: string; name: string }>;
    useLlm?: boolean;
    neo4jThrows?: boolean;
  } = {},
) {
  const read = jest.fn((cypher: string) => {
    if (opts.neo4jThrows) return Promise.reject(new Error('neo4j down'));
    if (cypher.includes('CONTAINS toLower(e.name)')) {
      return Promise.resolve(opts.substringRows ?? []);
    }
    return Promise.resolve(opts.llmMatchRows ?? []);
  });
  const neo4j = { read } as unknown as Neo4jService;

  const llm = {
    chatStructured: jest.fn().mockResolvedValue({
      data: { entities: opts.llmEntities ?? [] },
      usage: { inputTokens: 5, outputTokens: 3, estimatedCost: 0 },
    }),
  } as unknown as LlmService;

  const config = mockConfigService({
    graph: {
      retrieval: {
        maxHops: 2,
        maxEntityDegree: 200,
        topK: 10,
        linkUseLlm: opts.useLlm ?? true,
      },
    },
  });

  return {
    svc: new GraphEntityLinkerService(neo4j, llm, config),
    read,
    chatStructured: llm.chatStructured as jest.Mock,
  };
}

describe('GraphEntityLinkerService', () => {
  it('tầng 1 (substring) khớp → method=substring, KHÔNG gọi LLM', async () => {
    const { svc, chatStructured } = build({
      substringRows: [{ key: 'k1', name: 'Phòng Đào Tạo' }],
    });
    const r = await svc.link('Phòng Đào Tạo quản lý gì?');
    expect(r.method).toBe('substring');
    expect(r.seedKeys).toEqual(['k1']);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('tầng 1 rỗng → tầng 3 (LLM) rút thực thể rồi khớp tên', async () => {
    const { svc, chatStructured } = build({
      substringRows: [],
      llmEntities: ['Bách Khoa'],
      llmMatchRows: [{ key: 'k9', name: 'Bách Khoa' }],
    });
    const r = await svc.link('trường nào cấp bằng kỹ sư?');
    expect(chatStructured).toHaveBeenCalled();
    expect(r.method).toBe('llm');
    expect(r.seedKeys).toEqual(['k9']);
    expect(r.usage.inputTokens).toBe(5);
  });

  it('GRAPH_LINK_USE_LLM=false → không gọi LLM, trả none', async () => {
    const { svc, chatStructured } = build({ substringRows: [], useLlm: false });
    const r = await svc.link('câu hỏi mơ hồ');
    expect(chatStructured).not.toHaveBeenCalled();
    expect(r.method).toBe('none');
    expect(r.seedKeys).toEqual([]);
  });

  it('Neo4j lỗi → seed rỗng, không ném', async () => {
    const { svc } = build({ neo4jThrows: true, useLlm: false });
    await expect(svc.link('q')).resolves.toMatchObject({ seedKeys: [] });
  });

  it('LLM trả rỗng → không query khớp, method none', async () => {
    const { svc } = build({ substringRows: [], llmEntities: [] });
    const r = await svc.link('q');
    expect(r.method).toBe('none');
  });
});
