import { mockConfigService } from '../../config/config.mock';
import type { GroundingContext, RetrievedChunk } from '../../common/types';
import { ContextValidatorService } from './context-validator.service';

function ctx(scores: number[]): GroundingContext {
  const chunks: RetrievedChunk[] = scores.map((score, i) => ({
    chunkId: `c${i}`,
    documentId: 'd0',
    content: 'x',
    score,
    source: 'vector',
    metadata: {},
  }));
  return { chunks, totalTokens: chunks.length, sources: [] };
}

function make(rag: Partial<{ minChunks: number; minRelevance: number }> = {}) {
  return new ContextValidatorService(mockConfigService({ rag }));
}

describe('ContextValidatorService', () => {
  it('baseline (mặc định): chỉ abstain khi 0 chunk', () => {
    const v = make();
    expect(v.validate(ctx([])).proceed).toBe(false);
    expect(v.validate(ctx([])).status).toBe('INSUFFICIENT_EVIDENCE');
    expect(v.validate(ctx([0.01])).proceed).toBe(true);
  });

  it('abstain khi số chunk < RAG_MIN_CHUNKS', () => {
    const v = make({ minChunks: 3 });
    expect(v.validate(ctx([0.9, 0.8])).proceed).toBe(false);
    expect(v.validate(ctx([0.9, 0.8, 0.1])).proceed).toBe(true);
  });

  it('abstain khi điểm cao nhất < RAG_MIN_RELEVANCE', () => {
    const v = make({ minRelevance: 0.5 });
    expect(v.validate(ctx([0.4, 0.3])).proceed).toBe(false);
    expect(v.validate(ctx([0.6, 0.3])).proceed).toBe(true);
  });

  it('trả topScore của chunk đầu', () => {
    expect(make().validate(ctx([0.77, 0.2])).topScore).toBe(0.77);
    expect(make().validate(ctx([])).topScore).toBeNull();
  });
});
