import { mockConfigService } from '../../config/config.mock';
import type {
  Claim,
  RetrievedChunk,
} from '../../common/types/pipeline.contracts';
import {
  EvidenceMatcherService,
  matchClaimToChunks,
} from './evidence-matcher.service';

describe('EvidenceMatcherService & matchClaimToChunks', () => {
  const dummyChunk = (id: string, content: string): RetrievedChunk => ({
    chunkId: id,
    documentId: 'doc-1',
    content,
    score: 0.9,
    source: 'vector',
    metadata: {},
  });

  describe('matchClaimToChunks (pure function)', () => {
    it('claim khớp hoàn toàn 1 chunk → supported, evidenceChunkIds có chunk đó, score 1', () => {
      const claim = 'Đại học Bách Khoa đào tạo kỹ sư công nghệ';
      const chunks = [
        {
          chunkId: 'c1',
          content:
            'Trường Đại học Bách Khoa đào tạo kỹ sư công nghệ thông tin chất lượng cao.',
        },
      ];

      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.5,
        maxPerClaim: 3,
      });

      expect(result.supported).toBe(true);
      expect(result.score).toBe(1);
      expect(result.evidenceChunkIds).toEqual(['c1']);
    });

    it('claim không khớp chunk nào → unsupported, evidenceChunkIds rỗng, score 0', () => {
      const claim = 'Thời tiết hôm nay nắng ráo và ấm áp';
      const chunks = [
        {
          chunkId: 'c1',
          content:
            'Lịch sử phát triển của trí tuệ nhân tạo và học máy hiện đại.',
        },
      ];

      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.5,
        maxPerClaim: 3,
      });

      expect(result.supported).toBe(false);
      expect(result.score).toBe(0);
      expect(result.evidenceChunkIds).toEqual([]);
    });

    it('claim chỉ toàn stopword hoặc ký tự ngắn → unsupported, score 0, evidenceChunkIds rỗng', () => {
      const claim = 'và là của những một';
      const chunks = [
        {
          chunkId: 'c1',
          content: 'Nội dung bất kỳ có chứa từ ngữ.',
        },
      ];

      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.5,
        maxPerClaim: 3,
      });

      expect(result.supported).toBe(false);
      expect(result.score).toBe(0);
      expect(result.evidenceChunkIds).toEqual([]);
    });

    it('claim khớp nhiều chunk trên ngưỡng → sắp theo overlap giảm dần và giới hạn maxPerClaim', () => {
      const claim = 'Học phần lập trình cơ sở dữ liệu nâng cao';
      // claim tokens: hoc, phan, lap, trinh, co, so, du, lieu, nang, cao (10 tokens)
      const chunks = [
        {
          chunkId: 'c1',
          content: 'lập trình cơ sở dữ liệu cơ bản cho sinh viên', // lap, trinh, co, so, du, lieu, co, ban, sinh, vien -> 6 overlap
        },
        {
          chunkId: 'c2',
          content:
            'Học phần lập trình cơ sở dữ liệu nâng cao và kiến trúc phần mềm', // 10 overlap (10/10 = 1.0)
        },
        {
          chunkId: 'c3',
          content: 'Học phần lập trình cơ sở dữ liệu hệ thống thông tin', // 8 overlap
        },
        {
          chunkId: 'c4',
          content: 'Học phần lập trình nâng cao', // 4 overlap
        },
      ];

      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.5,
        maxPerClaim: 2,
      });

      expect(result.supported).toBe(true);
      expect(result.score).toBe(1);
      // Giới hạn maxPerClaim = 2, sắp theo overlap: c2 (1.0), c3 (0.8)
      expect(result.evidenceChunkIds).toEqual(['c2', 'c3']);
    });

    it('tie-break khi overlap bằng nhau: giữ thứ tự chunk đầu vào ban đầu', () => {
      const claim = 'Hệ thống phần mềm';
      const chunks = [
        { chunkId: 'c1', content: 'Hệ thống phần mềm A' },
        { chunkId: 'c2', content: 'Hệ thống phần mềm B' },
      ];

      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.5,
        maxPerClaim: 2,
      });

      expect(result.supported).toBe(true);
      expect(result.evidenceChunkIds).toEqual(['c1', 'c2']);
    });

    it('usedContextChunkIds kéo thêm chunk có overlap trung bình (>= minOverlap * 0.6)', () => {
      const claim = 'Sinh viên tham gia kỳ thi tiếng Anh quốc tế';
      // tokens: sinh, vien, tham, gia, ky, thi, tieng, anh, quoc, te (10 tokens)
      const chunks = [
        {
          chunkId: 'c_best',
          content:
            'Sinh viên tham gia kỳ thi tiếng Anh quốc tế đạt kết quả cao.', // 10 tokens khớp -> 1.0
        },
        {
          chunkId: 'c_prior',
          content: 'kỳ thi tiếng Anh quốc tế tại trường đại học', // 6 tokens khớp -> 6/10 = 0.6
        },
      ];

      // minOverlap = 0.8 => c_prior (0.6) không đủ trực tiếp (< 0.8), nhưng 0.6 >= 0.8 * 0.6 = 0.48
      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.8,
        maxPerClaim: 3,
        usedContextChunkIds: new Set(['c_prior']),
      });

      expect(result.supported).toBe(true);
      expect(result.score).toBe(1);
      expect(result.evidenceChunkIds).toEqual(['c_best', 'c_prior']);
    });

    it('usedContextChunkIds KHÔNG kéo chunk có overlap quá thấp (< minOverlap * 0.6)', () => {
      const claim = 'Sinh viên tham gia kỳ thi tiếng Anh quốc tế chuẩn đầu ra';
      const chunks = [
        {
          chunkId: 'c_best',
          content: 'Sinh viên tham gia kỳ thi tiếng Anh quốc tế chuẩn đầu ra.', // 1.0
        },
        {
          chunkId: 'c_low',
          content: 'Sinh viên có thể tham gia các hoạt động ngoại khóa.', // chỉ khớp 'sinh', 'vien', 'tham', 'gia' -> 4 / 11 ~ 0.36
        },
      ];

      // minOverlap = 0.8, minOverlap * 0.6 = 0.48. Overlap 0.36 < 0.48 -> loại bỏ
      const result = matchClaimToChunks(claim, chunks, {
        minOverlap: 0.8,
        maxPerClaim: 3,
        usedContextChunkIds: new Set(['c_low']),
      });

      expect(result.supported).toBe(true);
      expect(result.evidenceChunkIds).toEqual(['c_best']);
    });

    it('danh sách chunk rỗng → unsupported, score 0, evidenceChunkIds rỗng', () => {
      const claim = 'Khẳng định bất kỳ';
      const result = matchClaimToChunks(claim, [], {
        minOverlap: 0.5,
        maxPerClaim: 3,
      });

      expect(result.supported).toBe(false);
      expect(result.score).toBe(0);
      expect(result.evidenceChunkIds).toEqual([]);
    });
  });

  describe('EvidenceMatcherService (DI & API)', () => {
    it('sử dụng config mặc định từ ConfigService', () => {
      const config = mockConfigService({
        citation: {
          minOverlap: 0.6,
          maxPerClaim: 2,
        },
      });

      const service = new EvidenceMatcherService(config);
      const claims: Claim[] = [{ id: 'cl-1', text: 'Quy chế đào tạo đại học' }];
      const chunks: RetrievedChunk[] = [
        dummyChunk('c1', 'Quy chế đào tạo đại học năm 2026'),
      ];

      const evidence = service.match(claims, chunks);

      expect(evidence).toHaveLength(1);
      const first = evidence[0];
      expect(first?.claimId).toBe('cl-1');
      expect(first?.supported).toBe(true);
      expect(first?.verdict).toBe('SUPPORTED');
      expect(first?.evidenceChunkIds).toEqual(['c1']);
      expect(first?.score).toBeGreaterThanOrEqual(0.6);
    });

    it('override minOverlap và maxPerClaim qua opts', () => {
      const config = mockConfigService({
        citation: {
          minOverlap: 0.9,
          maxPerClaim: 1,
        },
      });

      const service = new EvidenceMatcherService(config);
      const claims: Claim[] = [
        { id: 'cl-1', text: 'Quy trình đăng ký học phần trực tuyến' },
      ];
      const chunks: RetrievedChunk[] = [
        dummyChunk('c1', 'Quy trình đăng ký học phần trực tuyến'),
        dummyChunk('c2', 'Quy trình đăng ký môn học trực tuyến bổ sung'),
      ];

      // Override minOverlap xuống 0.4 và maxPerClaim lên 2
      const evidence = service.match(claims, chunks, {
        minOverlap: 0.4,
        maxPerClaim: 2,
      });

      const first = evidence[0];
      expect(first?.supported).toBe(true);
      expect(first?.evidenceChunkIds).toHaveLength(2);
    });

    it('nhiều claims → trả về nhiều Evidence đúng thứ tự và claimId khớp', () => {
      const config = mockConfigService({
        citation: { minOverlap: 0.5, maxPerClaim: 3 },
      });
      const service = new EvidenceMatcherService(config);

      const claims: Claim[] = [
        { id: 'cl-1', text: 'Môn học tiên quyết của Giải tích 2' },
        { id: 'cl-2', text: 'Thời gian xét học bổng khuyến khích' },
        { id: 'cl-3', text: 'Địa điểm tổ chức hội nghị sinh viên' },
      ];

      const chunks: RetrievedChunk[] = [
        dummyChunk('c1', 'Môn học tiên quyết của Giải tích 2 là Giải tích 1.'),
        dummyChunk('c2', 'Thời gian xét học bổng khuyến khích vào đầu học kỳ.'),
      ];

      const evidence = service.match(claims, chunks);

      expect(evidence).toHaveLength(3);
      const [ev1, ev2, ev3] = evidence;

      expect(ev1?.claimId).toBe('cl-1');
      expect(ev1?.supported).toBe(true);
      expect(ev1?.verdict).toBe('SUPPORTED');
      expect(ev1?.evidenceChunkIds).toEqual(['c1']);

      expect(ev2?.claimId).toBe('cl-2');
      expect(ev2?.supported).toBe(true);
      expect(ev2?.verdict).toBe('SUPPORTED');
      expect(ev2?.evidenceChunkIds).toEqual(['c2']);

      expect(ev3?.claimId).toBe('cl-3');
      expect(ev3?.supported).toBe(false);
      expect(ev3?.verdict).toBe('UNSUPPORTED');
      expect(ev3?.evidenceChunkIds).toEqual([]);
    });

    it('tính tất định: gọi 2 lần với cùng input trả về kết quả giống nhau', () => {
      const config = mockConfigService();
      const service = new EvidenceMatcherService(config);

      const claims: Claim[] = [
        { id: 'c-1', text: 'Thông tin học phí và học bổng' },
      ];
      const chunks: RetrievedChunk[] = [
        dummyChunk('ck-1', 'Thông tin chi tiết về học phí và học bổng kỳ 1'),
      ];

      const res1 = service.match(claims, chunks);
      const res2 = service.match(claims, chunks);

      expect(res1).toEqual(res2);
    });
  });
});
