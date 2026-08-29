import { mockConfigService } from '../../config/config.mock';
import type { Neo4jService } from '../../graph/neo4j.service';
import type { Claim, Evidence, RetrievedChunk } from '../../common/types';
import { CitationService } from './citation.service';

function chunk(id: string, over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: id,
    documentId: over.documentId ?? 'doc-1',
    content: over.content ?? `Nội dung ${id}`,
    score: over.score ?? 0.8,
    source: over.source ?? 'vector',
    section: over.section,
    page: over.page,
    metadata: {},
  };
}

function neo4jStub(
  opts: { enabled?: boolean; connected?: boolean; rows?: unknown[] } = {},
): Neo4jService {
  return {
    enabled: opts.enabled ?? false,
    isConnected: opts.connected ?? false,
    read: jest.fn().mockResolvedValue(opts.rows ?? []),
  } as unknown as Neo4jService;
}

function make(neo4j: Neo4jService, relationshipCitations = true) {
  const config = mockConfigService({ citation: { relationshipCitations } });
  return new CitationService(neo4j, config);
}

describe('CitationService', () => {
  it('claim supported → citation kind=chunk trỏ đúng document/page/section', async () => {
    const svc = make(neo4jStub());
    const claims: Claim[] = [{ id: 'c1', text: 'Bảo lưu hai học kỳ.' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1'],
        verdict: 'SUPPORTED',
        score: 0.9,
      },
    ];
    const chunks = [
      chunk('k1', { documentId: 'doc-9', page: 3, section: 'Điều 5' }),
    ];
    const r = await svc.build(claims, evidence, chunks);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]).toMatchObject({
      claimId: 'c1',
      claimText: 'Bảo lưu hai học kỳ.',
      kind: 'chunk',
      documentId: 'doc-9',
      chunkId: 'k1',
      page: 3,
      section: 'Điều 5',
      valid: true,
    });
    expect(r.stats.chunkCitations).toBe(1);
  });

  it('claim không được hỗ trợ → 1 citation valid=false, đếm invalidClaims', async () => {
    const svc = make(neo4jStub());
    const claims: Claim[] = [{ id: 'c1', text: 'Khẳng định vô căn cứ.' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0.1,
      },
    ];
    const r = await svc.build(claims, evidence, [chunk('k1')]);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.valid).toBe(false);
    expect(r.citations[0]!.documentId).toBe('');
    expect(r.stats.invalidClaims).toBe(1);
  });

  it('nhiều evidence chunk → nhiều citation cho cùng claim', async () => {
    const svc = make(neo4jStub());
    const claims: Claim[] = [{ id: 'c1', text: 'x' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['k1', 'k2'],
        verdict: 'SUPPORTED',
        score: 0.8,
      },
    ];
    const r = await svc.build(claims, evidence, [chunk('k1'), chunk('k2')]);
    expect(r.citations).toHaveLength(2);
    expect(r.citations.every((c) => c.claimId === 'c1')).toBe(true);
  });

  it('evidenceChunkId không có trong context → bỏ qua (không bịa)', async () => {
    const svc = make(neo4jStub());
    const claims: Claim[] = [{ id: 'c1', text: 'x' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: true,
        evidenceChunkIds: ['ghost'],
        verdict: 'SUPPORTED',
        score: 0.8,
      },
    ];
    const r = await svc.build(claims, evidence, [chunk('k1')]);
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.valid).toBe(false);
  });

  it('Neo4j tắt → KHÔNG thử citation quan hệ', async () => {
    const neo = neo4jStub({ enabled: false });
    const svc = make(neo);
    const claims: Claim[] = [{ id: 'c1', text: 'Apple hợp tác với Microsoft.' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0,
      },
    ];
    await svc.build(claims, evidence, [chunk('k1')]);
    expect(neo.read).not.toHaveBeenCalled();
  });

  it('claim quan hệ (2 thực thể) + Neo4j có cạnh RELATED → citation kind=relationship', async () => {
    const neo = neo4jStub({
      enabled: true,
      connected: true,
      rows: [
        {
          source: 'Apple',
          target: 'Microsoft',
          relType: 'PARTNERSHIP',
          chunkIds: ['k1'],
          documentIds: ['doc-1'],
        },
      ],
    });
    const svc = make(neo);
    const claims: Claim[] = [
      { id: 'c1', text: 'Apple hợp tác với Microsoft trong dự án chung.' },
    ];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0.2,
      },
    ];
    const r = await svc.build(claims, evidence, [chunk('k1')]);
    expect(r.stats.relationshipCitations).toBe(1);
    expect(r.citations[0]).toMatchObject({
      kind: 'relationship',
      sourceEntity: 'Apple',
      targetEntity: 'Microsoft',
      relationType: 'PARTNERSHIP',
      chunkId: 'k1',
      valid: true,
    });
  });

  it('Neo4j read ném lỗi → best-effort, claim thành valid=false (không vỡ)', async () => {
    const neo = {
      enabled: true,
      isConnected: true,
      read: jest.fn().mockRejectedValue(new Error('neo4j down')),
    } as unknown as Neo4jService;
    const svc = make(neo);
    const claims: Claim[] = [{ id: 'c1', text: 'Apple mua lại Beats Audio.' }];
    const evidence: Evidence[] = [
      {
        claimId: 'c1',
        supported: false,
        evidenceChunkIds: [],
        verdict: 'UNSUPPORTED',
        score: 0,
      },
    ];
    const r = await svc.build(claims, evidence, [chunk('k1')]);
    expect(r.citations[0]!.valid).toBe(false);
  });
});
