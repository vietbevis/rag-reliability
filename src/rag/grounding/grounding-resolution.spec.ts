import type { RetrievedChunk, VerifiedClaim } from '../../common/types';
import {
  applyNumericProvenance,
  resolveGroundedStatus,
} from './grounding-resolution';

const chunk = (id: string, content: string): RetrievedChunk => ({
  chunkId: id,
  documentId: 'doc-1',
  content,
  score: 0.9,
  source: 'vector',
  metadata: {},
});

const claim = (over: Partial<VerifiedClaim>): VerifiedClaim => ({
  id: 'c1',
  text: 'x',
  supported: false,
  verdict: 'UNSUPPORTED',
  evidenceChunkIds: [],
  ...over,
});

describe('applyNumericProvenance', () => {
  it('claim chứa số ĐÃ có trong evidence (khác định dạng) → nâng SUPPORTED', () => {
    const claims = [claim({ text: 'Tổng doanh thu là 684.500 đồng.' })];
    const cites = applyNumericProvenance(claims, [
      chunk('k1', 'Doanh thu ghi nhận 684500 đồng trong kỳ.'),
    ]);
    expect(claims[0]!.supported).toBe(true);
    expect(claims[0]!.verdict).toBe('SUPPORTED');
    expect(cites[0]).toMatchObject({ chunkId: 'k1', valid: true });
  });

  it('KHÔNG lấn claim đã CONTRADICTED', () => {
    const claims = [claim({ text: '42', verdict: 'CONTRADICTED' })];
    applyNumericProvenance(claims, [chunk('k1', 'giá trị 42')]);
    expect(claims[0]!.verdict).toBe('CONTRADICTED');
  });

  it('số trong claim KHÔNG có trong evidence → giữ nguyên', () => {
    const claims = [claim({ text: 'Có 999 sinh viên.' })];
    applyNumericProvenance(claims, [chunk('k1', 'Có 100 sinh viên.')]);
    expect(claims[0]!.supported).toBe(false);
  });
});

describe('resolveGroundedStatus', () => {
  it('claim CONTRADICTED → CONFLICTING_EVIDENCE', () => {
    expect(
      resolveGroundedStatus({
        claims: [claim({ verdict: 'CONTRADICTED' })],
        faithGrounded: true,
        initialStatus: 'GROUNDED',
      }),
    ).toBe('CONFLICTING_EVIDENCE');
  });

  it('không grounded + đang GROUNDED → PARTIALLY_GROUNDED', () => {
    expect(
      resolveGroundedStatus({
        claims: [claim({ supported: true, verdict: 'SUPPORTED' })],
        faithGrounded: false,
        initialStatus: 'GROUNDED',
      }),
    ).toBe('PARTIALLY_GROUNDED');
  });

  it('mọi claim unsupported → INSUFFICIENT_EVIDENCE', () => {
    expect(
      resolveGroundedStatus({
        claims: [claim({}), claim({ id: 'c2' })],
        faithGrounded: false,
        initialStatus: 'GROUNDED',
      }),
    ).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('có claim supported → giữ GROUNDED', () => {
    expect(
      resolveGroundedStatus({
        claims: [claim({ supported: true, verdict: 'SUPPORTED' })],
        faithGrounded: true,
        initialStatus: 'GROUNDED',
      }),
    ).toBe('GROUNDED');
  });
});
