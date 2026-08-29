import { mockConfigService } from '../../config/config.mock';
import { LlmService } from '../../ai/llm/llm.service';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphEntityLinkerService } from './graph-entity-linker.service';

function build(
  opts: {
    ftsRows?: Array<{ key: string; name: string }>;
    llmEntities?: string[];
    llmMatchRows?: Array<{ key: string; name: string }>;
    useLlm?: boolean;
    ftsThrows?: boolean;
    matchThrows?: boolean;
  } = {},
) {
  const read = jest.fn((cypher: string) => {
    if (cypher.includes('db.index.fulltext.queryNodes')) {
      if (opts.ftsThrows) return Promise.reject(new Error('neo4j down'));
      return Promise.resolve(opts.ftsRows ?? []);
    }
    // tầng 3 match
    if (opts.matchThrows) return Promise.reject(new Error('neo4j down'));
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
  it('tầng 1 (fulltext + hậu lọc) khớp tên đa từ trong query → method=substring', async () => {
    const { svc, chatStructured } = build({
      ftsRows: [{ key: 'k1', name: 'Phòng Đào Tạo' }],
    });
    const r = await svc.link('Phòng Đào Tạo quản lý hồ sơ gì?');
    expect(r.method).toBe('substring');
    expect(r.seedKeys).toEqual(['k1']);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('hậu lọc loại tên NGẮN 1 từ khớp nhầm ("Nam" trong "Việt Nam")', async () => {
    const { svc } = build({
      ftsRows: [
        { key: 'kshort', name: 'Nam' }, // 1 từ, < 6 ký tự → loại
        { key: 'kok', name: 'Đại học Bách Khoa' }, // đa từ → giữ (nếu có trong query)
      ],
    });
    const r = await svc.link('Việt Nam có trường Đại học Bách Khoa');
    expect(r.seedKeys).toEqual(['kok']);
  });

  it('tầng 1 rỗng → tầng 3 (LLM) rút thực thể rồi khớp', async () => {
    const { svc, chatStructured } = build({
      ftsRows: [],
      llmEntities: ['Bách Khoa'],
      llmMatchRows: [{ key: 'k9', name: 'Bách Khoa' }],
    });
    const r = await svc.link('trường nào cấp bằng kỹ sư?');
    expect(chatStructured).toHaveBeenCalled();
    expect(r.method).toBe('llm');
    expect(r.seedKeys).toEqual(['k9']);
  });

  it('Neo4j lỗi ở tầng 1 → error=neo4j_unavailable, KHÔNG gọi LLM', async () => {
    const { svc, chatStructured } = build({ ftsThrows: true });
    const r = await svc.link('câu hỏi bất kỳ');
    expect(r.error).toBe('neo4j_unavailable');
    expect(r.seedKeys).toEqual([]);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('Neo4j lỗi ở tầng 3 (match) → error=neo4j_unavailable', async () => {
    const { svc } = build({
      ftsRows: [],
      llmEntities: ['Bách Khoa'],
      matchThrows: true,
    });
    const r = await svc.link('q');
    expect(r.error).toBe('neo4j_unavailable');
  });

  it('GRAPH_LINK_USE_LLM=false → không gọi LLM, method none', async () => {
    const { svc, chatStructured } = build({ ftsRows: [], useLlm: false });
    const r = await svc.link('câu hỏi mơ hồ');
    expect(chatStructured).not.toHaveBeenCalled();
    expect(r.method).toBe('none');
  });
});
