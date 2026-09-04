import type {
  Citation,
  RagStatus,
  RetrievedChunk,
  VerifiedClaim,
} from '../../common/types';
import {
  chunksBackingNumbers,
  extractNumbers,
  isGenericYear,
} from './numeric-provenance';

/**
 * Lõi verify DÙNG CHUNG giữa `RagPipelineService` (/rag/query) và
 * `AnswerVerificationService` (agent finalize) — PROMPT §24-28. Phần KHÁC nhau
 * (RAG dùng citation-marker của generator để khớp evidence; agent lấy evidence
 * từ tool result) giữ riêng ở mỗi service.
 */

/**
 * §9.3 numeric-provenance: claim chứa số ĐÃ xuất hiện trong evidence (chuẩn hoá
 * bỏ dấu phân cách — "684.500" ≡ "684500") ⇒ nâng verdict SUPPORTED + sinh
 * citation. Bù cho lexical/NLI trượt định dạng số. **KHÔNG lấn CONTRADICTED.**
 *
 * [P1] Không tự nâng SUPPORTED nếu số DUY NHẤT trùng là một năm dương lịch trơ
 * trọi ({@link isGenericYear}) — năm lặp lại ở hầu hết câu cùng chủ đề ngày
 * tháng nên trùng năm không chứng minh được nội dung thật của claim (vd claim
 * sai "9/9/2026 là Thứ Ba" bị ép SUPPORTED chỉ vì evidence khác cũng nhắc
 * "2026"). Cần ít nhất một số ĐẶC TRƯNG (giá tiền, cổng, id, số lượng…) khớp.
 *
 * Mutate `claims` tại chỗ; trả citation phát sinh.
 */
export function applyNumericProvenance(
  claims: VerifiedClaim[],
  chunks: readonly RetrievedChunk[],
): Citation[] {
  const provCitations: Citation[] = [];
  for (const c of claims) {
    if (c.supported || c.verdict === 'CONTRADICTED') continue;
    const claimNums = extractNumbers(c.text);
    if (claimNums.size === 0) continue;
    if ([...claimNums].every(isGenericYear)) continue;
    const backing = chunksBackingNumbers(c.text, chunks);
    const allBacked = [...claimNums].every((n) =>
      backing.some((id) =>
        extractNumbers(
          chunks.find((ch) => ch.chunkId === id)?.content ?? '',
        ).has(n),
      ),
    );
    if (!allBacked) continue;
    c.supported = true;
    c.verdict = 'SUPPORTED';
    c.evidenceChunkIds = backing.slice(0, 3);
    for (const chunkId of c.evidenceChunkIds) {
      const ch = chunks.find((x) => x.chunkId === chunkId);
      if (ch) {
        provCitations.push({
          claimId: c.id,
          claimText: c.text,
          kind: 'chunk',
          documentId: ch.documentId,
          chunkId: ch.chunkId,
          page: ch.page,
          section: ch.section,
          valid: true,
        });
      }
    }
  }
  return provCitations;
}

/**
 * Suy `RagStatus` cuối từ claim đã verify + kết quả faithfulness verifier:
 * - mâu thuẫn (claim CONTRADICTED hoặc rootCause CONFLICTING_CONTEXT) → CONFLICTING_EVIDENCE
 * - không grounded mà đang GROUNDED → PARTIALLY_GROUNDED
 * - mọi claim unsupported (và không mâu thuẫn) → INSUFFICIENT_EVIDENCE
 */
export function resolveGroundedStatus(args: {
  claims: readonly VerifiedClaim[];
  faithGrounded: boolean;
  faithRootCause?: string;
  initialStatus: RagStatus;
}): RagStatus {
  let status = args.initialStatus;
  const hasContradiction = args.claims.some(
    (c) => c.verdict === 'CONTRADICTED',
  );
  if (hasContradiction || args.faithRootCause === 'CONFLICTING_CONTEXT') {
    return 'CONFLICTING_EVIDENCE';
  }
  if (!args.faithGrounded && status === 'GROUNDED') {
    status = 'PARTIALLY_GROUNDED';
  }
  if (args.claims.length > 0 && args.claims.every((c) => !c.supported)) {
    status = 'INSUFFICIENT_EVIDENCE';
  }
  return status;
}
