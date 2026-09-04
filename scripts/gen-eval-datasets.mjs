#!/usr/bin/env node
/**
 * Sinh 5 file golden dataset lõi (answerable/multi-hop/conflicting/unanswerable/
 * adversarial) từ một THƯ VIỆN CORPUS gọn. Các file mở rộng PHASE 19 (semantic,
 * numerical, cross-document, entity-disambiguation, distractor,
 * vietnamese-robustness, agent-routing, golden) do
 * `scripts/gen-eval-datasets-extended.mjs` sinh. Chạy cả hai: `npm run dataset:generate`.
 *
 * Vì sao có script này (docs/audit/EVALUATION_REVIEW.md §4.1): giữ nguồn sự thật
 * ở một chỗ, dễ mở rộng lên hàng trăm case mà không copy-paste corpus. Mỗi case
 * .jsonl vẫn tự mang corpus (seed độc lập) — script resolve từ thư viện.
 *
 * Field mở rộng (category/difficulty/reasoningSteps/requiredFacts/forbiddenClaims/
 * negativeType/…) được `enrich()` gắn tự động + PATCHES; schema đầy đủ ở
 * src/evaluation/datasets/case.schema.ts, tài liệu ở docs/evaluation-dataset.md.
 *
 * Nội dung quy chế dưới đây là MÔ PHỎNG học thuật cho mục đích đánh giá RAG,
 * KHÔNG phải văn bản pháp quy thật của bất kỳ trường nào.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './eval-corpus.mjs'; // THƯ VIỆN CORPUS dùng chung

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../evaluation/datasets');

// ---------------------------------------------------------------------------
// HỖ TRỢ
// ---------------------------------------------------------------------------
function corpusOf(sources) {
  return sources.map((s) => {
    const d = CORPUS[s];
    if (!d) throw new Error(`Thiếu corpus source: ${s}`);
    return { title: d.title, source: s, text: d.text };
  });
}

// Map `type` (enum DB) → `category` mịn (lưu trong metadata). Xem
// src/evaluation/datasets/case.schema.ts và docs/evaluation-dataset.md.
const CATEGORY_BY_TYPE = {
  DIRECT_RETRIEVAL: 'direct_retrieval',
  SEMANTIC_QUERY: 'semantic_paraphrase',
  EXACT_IDENTIFIER: 'numerical_exact',
  MULTI_HOP: 'multi_hop',
  CONFLICTING_SOURCES: 'conflicting',
  UNANSWERABLE: 'unanswerable',
  ADVERSARIAL: 'false_premise',
};

/** Bổ sung các field mở rộng (OPTIONAL, có default) cho một case. */
const DIFFICULTY_BY_TYPE = {
  DIRECT_RETRIEVAL: 'easy',
  EXACT_IDENTIFIER: 'easy',
  SEMANTIC_QUERY: 'medium',
  UNANSWERABLE: 'medium',
  ADVERSARIAL: 'hard',
  MULTI_HOP: 'hard',
  CONFLICTING_SOURCES: 'hard',
};

function enrich(base, type, opts = {}) {
  const multi = type === 'MULTI_HOP' || type === 'CONFLICTING_SOURCES';
  return {
    ...base,
    acceptableAnswers: opts.acceptableAnswers ?? [],
    alternativeDocuments: opts.alternativeDocuments ?? [],
    distractorDocuments: opts.distractorDocuments ?? [],
    requiredFacts: opts.requiredFacts ?? [],
    forbiddenClaims: opts.forbiddenClaims ?? [],
    shouldAbstain: base.answerable ? false : (opts.shouldAbstain ?? true),
    category: opts.category ?? CATEGORY_BY_TYPE[type] ?? null,
    difficulty: opts.difficulty ?? DIFFICULTY_BY_TYPE[type] ?? 'medium',
    reasoningSteps: opts.reasoningSteps ?? (multi ? 2 : 1),
    language: opts.language ?? 'vi',
    negativeType: base.answerable
      ? null
      : (opts.negativeType ??
        (type === 'ADVERSARIAL' ? 'false_premise' : 'completely_unknown')),
    expectedAction: opts.expectedAction ?? null,
    metadata: opts.metadata ?? {},
  };
}

function ans(id, type, question, expectedAnswer, expectedDocuments, extraCorpus = [], opts = {}) {
  return enrich(
    {
      id,
      type,
      question,
      answerable: true,
      expectedAnswer,
      expectedDocuments,
      corpus: corpusOf([
        ...new Set([
          ...expectedDocuments,
          ...(opts.alternativeDocuments ?? []),
          ...(opts.distractorDocuments ?? []),
          ...extraCorpus,
        ]),
      ]),
    },
    type,
    opts,
  );
}

function noAns(id, type, question, corpusSources, opts = {}) {
  return enrich(
    {
      id,
      type,
      question,
      answerable: false,
      expectedAnswer: null,
      expectedDocuments: [],
      corpus: corpusOf(corpusSources),
    },
    type,
    opts,
  );
}

// Bộ "nhiễu" hay dùng để mỗi case có nhiều tài liệu, ép retrieval phải chọn đúng.
const NOISE = ['quy-che-hoc-vu', 'quy-dinh-hoc-phi', 'quy-che-thi', 'quy-che-tot-nghiep'];

// ---------------------------------------------------------------------------
// CASE — ANSWERABLE (DIRECT / SEMANTIC / EXACT_IDENTIFIER)
// ---------------------------------------------------------------------------
const answerable = [
  ans('ans-baoluu-thoigian', 'DIRECT_RETRIEVAL',
    'Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?',
    'Tối đa hai học kỳ liên tiếp trong toàn khoá học; vượt quá chỉ xét khi bất khả kháng.',
    ['quy-che-bao-luu'], ['quy-dinh-hoc-phi']),
  ans('ans-baoluu-thutuc', 'DIRECT_RETRIEVAL',
    'Đơn xin bảo lưu phải nộp trước khi nào và cho ai?',
    'Nộp cho phòng đào tạo trước ngày bắt đầu học kỳ ít nhất mười lăm ngày làm việc, có xác nhận của cố vấn học tập và khoa quản lý ngành.',
    ['quy-che-bao-luu'], NOISE),
  ans('ans-baoluu-quyenloi', 'SEMANTIC_QUERY',
    'Trong thời gian bảo lưu sinh viên có được đăng ký học phần và dự thi không?',
    'Không. Trong thời gian bảo lưu sinh viên không được đăng ký học phần, không được dự thi và không hưởng chế độ chính sách cho sinh viên đang học.',
    ['quy-che-bao-luu'], NOISE),
  ans('ans-baoluu-trolai', 'DIRECT_RETRIEVAL',
    'Hết thời hạn bảo lưu, sinh viên phải làm thủ tục nhập học trở lại trong bao lâu?',
    'Trong vòng ba mươi ngày; quá hạn không có lý do chính đáng sẽ bị xoá tên.',
    ['quy-che-bao-luu']),
  ans('ans-hocphi-hannop', 'DIRECT_RETRIEVAL',
    'Hạn đóng học phí là bao lâu kể từ khi học kỳ bắt đầu?',
    'Trong vòng bốn tuần kể từ ngày bắt đầu học kỳ; quá hạn không lý do chính đáng bị xoá tên khỏi lớp học phần.',
    ['quy-dinh-hoc-phi'], NOISE),
  ans('ans-hocphi-hoantra', 'SEMANTIC_QUERY',
    'Rút học phần ở tuần thứ tư của học kỳ thì được hoàn lại bao nhiêu phần trăm học phí?',
    'Được hoàn trả 50% (áp dụng cho rút từ tuần thứ ba đến tuần thứ sáu).',
    ['quy-dinh-hoc-phi']),
  ans('ans-hocphi-mienGiam', 'DIRECT_RETRIEVAL',
    'Hồ sơ xét miễn giảm học phí nộp khi nào?',
    'Nộp trong tháng đầu tiên của học kỳ.',
    ['quy-dinh-hoc-phi'], NOISE),
  ans('ans-hocphi-donGia', 'SEMANTIC_QUERY',
    'Ai quyết định đơn giá một tín chỉ và công bố lúc nào?',
    'Hiệu trưởng quyết định và công bố trước khi bắt đầu năm học.',
    ['quy-dinh-hoc-phi']),
  ans('ans-totnghiep-gpa', 'EXACT_IDENTIFIER',
    'Điểm trung bình tích luỹ tối thiểu để được xét tốt nghiệp là bao nhiêu?',
    'Từ 2,0 trở lên theo thang 4, cùng với đủ tín chỉ, không còn điểm F và không bị kỷ luật từ mức đình chỉ.',
    ['quy-che-tot-nghiep'], NOISE),
  ans('ans-totnghiep-xeploai-gioi', 'EXACT_IDENTIFIER',
    'Khoảng điểm trung bình tích luỹ để tốt nghiệp loại giỏi là bao nhiêu?',
    'Từ 3,2 đến cận 3,6 theo thang 4.',
    ['quy-che-tot-nghiep']),
  ans('ans-totnghiep-xeploai-xuatsac', 'EXACT_IDENTIFIER',
    'Tốt nghiệp loại xuất sắc cần điểm trung bình tích luỹ bao nhiêu?',
    'Từ 3,6 đến 4,0 theo thang 4.',
    ['quy-che-tot-nghiep']),
  ans('ans-totnghiep-hamuc', 'SEMANTIC_QUERY',
    'Khi nào sinh viên bị hạ một mức xếp loại tốt nghiệp?',
    'Khi khối lượng học phần phải học lại vượt quá 5% tổng số tín chỉ, hoặc bị kỷ luật từ mức khiển trách trở lên trong thời gian học.',
    ['quy-che-tot-nghiep'], NOISE),
  ans('ans-totnghiep-ngoaingu', 'DIRECT_RETRIEVAL',
    'Chuẩn đầu ra ngoại ngữ để xét tốt nghiệp là gì?',
    'Tiếng Anh bậc 3 theo Khung năng lực ngoại ngữ 6 bậc dùng cho Việt Nam, hoặc chứng chỉ tương đương được nhà trường công nhận.',
    ['quy-che-tot-nghiep', 'quy-dinh-chuan-tieng-anh']),
  ans('ans-thi-dieukien-vang', 'EXACT_IDENTIFIER',
    'Vắng bao nhiêu phần trăm số tiết thì không được dự thi kết thúc học phần?',
    'Vắng quá 20% số tiết của học phần thì không được dự thi kết thúc học phần đó.',
    ['quy-che-thi'], NOISE),
  ans('ans-thi-trongso', 'DIRECT_RETRIEVAL',
    'Điểm thi kết thúc học phần chiếm trọng số bao nhiêu trong điểm học phần?',
    'Trọng số 60%, phần còn lại 40% là điểm đánh giá quá trình, trừ khi đề cương quy định khác.',
    ['quy-che-thi']),
  ans('ans-thi-vangthi', 'SEMANTIC_QUERY',
    'Sinh viên vắng thi không có lý do chính đáng bị xử lý thế nào?',
    'Nhận điểm 0 cho bài thi kết thúc học phần.',
    ['quy-che-thi'], NOISE),
  ans('ans-thi-caithien', 'SEMANTIC_QUERY',
    'Học phần đạt điểm D có được học cải thiện không và lấy điểm nào?',
    'Được đăng ký học cải thiện; điểm cao hơn trong hai lần học được dùng để tính điểm trung bình tích luỹ.',
    ['quy-che-thi', 'quy-dinh-quy-doi-diem']),
  ans('ans-hocvu-canhbao-dau', 'EXACT_IDENTIFIER',
    'Điểm trung bình học kỳ đầu dưới bao nhiêu thì bị cảnh báo học vụ?',
    'Dưới 1,0 đối với học kỳ đầu.',
    ['quy-che-hoc-vu'], NOISE),
  ans('ans-hocvu-buocthoihoc', 'DIRECT_RETRIEVAL',
    'Bị cảnh báo học vụ mấy học kỳ liên tiếp thì bị buộc thôi học?',
    'Ba học kỳ liên tiếp, hoặc vượt quá thời gian tối đa hoàn thành chương trình.',
    ['quy-che-hoc-vu'], NOISE),
  ans('ans-hocvu-thoigiantoida', 'SEMANTIC_QUERY',
    'Thời gian tối đa để hoàn thành chương trình đào tạo được tính thế nào?',
    'Bằng thời gian thiết kế của chương trình cộng thêm hai năm; thời gian bảo lưu không tính vào.',
    ['quy-che-hoc-vu', 'quy-che-bao-luu']),
  ans('ans-hocvu-tinchi-toithieu', 'EXACT_IDENTIFIER',
    'Mỗi học kỳ chính sinh viên phải đăng ký tối thiểu bao nhiêu tín chỉ?',
    'Tối thiểu 14 tín chỉ, trừ học kỳ cuối khoá.',
    ['quy-che-hoc-vu']),
  ans('ans-hocvu-tinchi-canhbao', 'SEMANTIC_QUERY',
    'Sinh viên đang bị cảnh báo học vụ được đăng ký tối đa bao nhiêu tín chỉ?',
    'Tối đa 14 tín chỉ.',
    ['quy-che-hoc-vu'], NOISE),
  ans('ans-chuyennganh-dieukien', 'DIRECT_RETRIEVAL',
    'Điều kiện để được xét chuyển ngành là gì?',
    'Học xong năm thứ nhất, điểm trung bình tích luỹ từ 2,5 trở lên, không bị kỷ luật và ngành đến còn chỉ tiêu.',
    ['quy-dinh-chuyen-nganh'], NOISE),
  ans('ans-chuyennganh-solan', 'EXACT_IDENTIFIER',
    'Mỗi sinh viên được chuyển ngành mấy lần trong khoá học?',
    'Chỉ một lần trong toàn khoá học.',
    ['quy-dinh-chuyen-nganh']),
  ans('ans-chuyennganh-nopho', 'DIRECT_RETRIEVAL',
    'Hồ sơ chuyển ngành nộp vào thời gian nào?',
    'Trong bốn tuần đầu của học kỳ 2 năm thứ nhất.',
    ['quy-dinh-chuyen-nganh']),
  ans('ans-chuyentruong-tinchi', 'SEMANTIC_QUERY',
    'Sinh viên chuyển trường đến phải tích luỹ tối thiểu bao nhiêu phần trăm tín chỉ tại trường để xét tốt nghiệp?',
    'Tối thiểu 50% số tín chỉ của chương trình và phải học tối thiểu hai năm cuối tại trường.',
    ['quy-dinh-chuyen-nganh', 'quy-che-tot-nghiep']),
  ans('ans-hocbong-dieukien', 'DIRECT_RETRIEVAL',
    'Điều kiện học tập để được xét học bổng khuyến khích học tập là gì?',
    'Điểm trung bình học kỳ từ 3,2 trở lên theo thang 4, điểm rèn luyện từ 80, không có học phần dưới điểm C trong học kỳ xét và không bị kỷ luật.',
    ['quy-che-hoc-bong', 'quy-dinh-ren-luyen'], NOISE),
  ans('ans-hocbong-muc-gioi', 'EXACT_IDENTIFIER',
    'Học bổng loại giỏi bằng bao nhiêu lần học phí một học kỳ?',
    'Bằng 1,2 lần học phí một học kỳ.',
    ['quy-che-hoc-bong']),
  ans('ans-hocbong-soluong', 'SEMANTIC_QUERY',
    'Số suất học bổng mỗi ngành bị giới hạn thế nào?',
    'Không vượt quá 10% số sinh viên của ngành trong học kỳ xét.',
    ['quy-che-hoc-bong']),
  ans('ans-kyluat-cachinhthuc', 'DIRECT_RETRIEVAL',
    'Có mấy mức kỷ luật sinh viên và là những mức nào?',
    'Bốn mức: khiển trách, cảnh cáo, đình chỉ học tập có thời hạn và buộc thôi học.',
    ['quy-che-ky-luat'], NOISE),
  ans('ans-kyluat-thiho', 'SEMANTIC_QUERY',
    'Thi hộ hoặc nhờ thi hộ bị xử lý thế nào?',
    'Cả hai bị đình chỉ học tập một năm.',
    ['quy-che-ky-luat']),
  ans('ans-kyluat-hieuluc-canhcao', 'EXACT_IDENTIFIER',
    'Quyết định kỷ luật cảnh cáo có hiệu lực trong bao lâu?',
    'Trong một năm học.',
    ['quy-che-ky-luat']),
  ans('ans-kyluat-taiLieuTraiPhep', 'DIRECT_RETRIEVAL',
    'Mang tài liệu trái phép vào phòng thi bị xử lý ra sao?',
    'Bị đình chỉ thi và nhận điểm 0 học phần.',
    ['quy-che-ky-luat', 'quy-che-thi']),
  ans('ans-thuctap-dieukien', 'DIRECT_RETRIEVAL',
    'Cần tích luỹ tối thiểu bao nhiêu tín chỉ để đăng ký thực tập tốt nghiệp?',
    'Tối thiểu 100 tín chỉ và không còn nợ học phần tiên quyết của học phần thực tập.',
    ['quy-dinh-thuc-tap'], NOISE),
  ans('ans-thuctap-thoiluong', 'EXACT_IDENTIFIER',
    'Thực tập tốt nghiệp kéo dài tối thiểu bao nhiêu tuần?',
    'Tối thiểu tám tuần liên tục tại đơn vị tiếp nhận, tương đương 4 tín chỉ.',
    ['quy-dinh-thuc-tap']),
  ans('ans-thuctap-danhgia', 'SEMANTIC_QUERY',
    'Điểm thực tập tốt nghiệp được tính từ những thành phần nào?',
    'Điểm của người hướng dẫn tại đơn vị trọng số 50% và điểm bảo vệ báo cáo trước hội đồng bộ môn trọng số 50%.',
    ['quy-dinh-thuc-tap']),
  ans('ans-doan-dieukien', 'DIRECT_RETRIEVAL',
    'Điều kiện để được giao đồ án tốt nghiệp là gì?',
    'Tích luỹ tối thiểu 85% số tín chỉ chương trình, điểm trung bình tích luỹ từ 2,5 trở lên và đã hoàn thành học phần thực tập tốt nghiệp.',
    ['quy-dinh-do-an', 'quy-dinh-thuc-tap'], NOISE),
  ans('ans-doan-giahan', 'EXACT_IDENTIFIER',
    'Sinh viên không hoàn thành đồ án đúng hạn được gia hạn tối đa bao lâu?',
    'Tối đa một học kỳ, sau đó phải nhận đề tài mới.',
    ['quy-dinh-do-an']),
  ans('ans-doan-baove', 'SEMANTIC_QUERY',
    'Sinh viên được bảo vệ đồ án khi nào?',
    'Khi có nhận xét đồng ý cho bảo vệ của giảng viên hướng dẫn và của giảng viên phản biện.',
    ['quy-dinh-do-an']),
  ans('ans-dangky-thoigian', 'DIRECT_RETRIEVAL',
    'Đăng ký học phần diễn ra khi nào?',
    'Trực tuyến trong hai tuần trước khi học kỳ bắt đầu; được điều chỉnh trong tuần đầu tiên của học kỳ.',
    ['quy-dinh-dang-ky-hoc-phan'], NOISE),
  ans('ans-dangky-rut-W', 'SEMANTIC_QUERY',
    'Rút học phần được thực hiện đến khi nào và ghi ký hiệu gì trên bảng điểm?',
    'Đến hết tuần thứ sáu của học kỳ; học phần đã rút ghi ký hiệu W và không tính vào điểm trung bình.',
    ['quy-dinh-dang-ky-hoc-phan', 'quy-dinh-quy-doi-diem']),
  ans('ans-dangky-huylop', 'EXACT_IDENTIFIER',
    'Lớp học phần có dưới bao nhiêu sinh viên đăng ký thì có thể bị huỷ?',
    'Dưới 20 sinh viên.',
    ['quy-dinh-dang-ky-hoc-phan']),
  ans('ans-renluyen-xuatsac', 'EXACT_IDENTIFIER',
    'Điểm rèn luyện từ bao nhiêu thì xếp loại xuất sắc?',
    'Từ 90 điểm trở lên theo thang 100.',
    ['quy-dinh-ren-luyen'], NOISE),
  ans('ans-renluyen-kyluat', 'SEMANTIC_QUERY',
    'Sinh viên bị khiển trách trong học kỳ thì điểm rèn luyện tối đa xếp loại gì?',
    'Không vượt quá loại trung bình.',
    ['quy-dinh-ren-luyen', 'quy-che-ky-luat']),
  ans('ans-nghihoc-suckhoe', 'DIRECT_RETRIEVAL',
    'Nghỉ học tạm thời vì lý do sức khoẻ được tối đa mấy học kỳ?',
    'Tối đa hai học kỳ, có giấy của cơ sở y tế.',
    ['quy-dinh-nghi-hoc-tam-thoi'], NOISE),
  ans('ans-nghihoc-canhan', 'SEMANTIC_QUERY',
    'Nghỉ học tạm thời vì lý do cá nhân cần điều kiện gì?',
    'Đã học ít nhất một học kỳ tại trường, không bị kỷ luật, không nợ học phí; thời gian nghỉ tối đa một học kỳ.',
    ['quy-dinh-nghi-hoc-tam-thoi']),
  ans('ans-thoihoc-thoigian', 'EXACT_IDENTIFIER',
    'Nhà trường giải quyết đơn xin thôi học trong bao lâu?',
    'Trong mười lăm ngày làm việc, kèm cấp bảng điểm các học phần đã tích luỹ.',
    ['quy-dinh-nghi-hoc-tam-thoi']),
  ans('ans-phuckhao-thoihan', 'EXACT_IDENTIFIER',
    'Đơn phúc khảo bài thi phải nộp trong bao nhiêu ngày kể từ khi công bố điểm?',
    'Trong vòng bảy ngày kể từ ngày công bố điểm; quá hạn không được tiếp nhận.',
    ['quy-dinh-phuc-khao'], NOISE),
  ans('ans-phuckhao-quytrinh', 'SEMANTIC_QUERY',
    'Bài phúc khảo được chấm như thế nào?',
    'Do hai giảng viên chấm độc lập, không phải giảng viên đã chấm lần đầu; kết quả công bố trong mười lăm ngày làm việc.',
    ['quy-dinh-phuc-khao']),
  ans('ans-phuckhao-lephi', 'DIRECT_RETRIEVAL',
    'Lệ phí phúc khảo có được hoàn lại không?',
    'Được hoàn trả nếu điểm được điều chỉnh tăng sau phúc khảo.',
    ['quy-dinh-phuc-khao']),
  ans('ans-quydoi-A', 'EXACT_IDENTIFIER',
    'Điểm số 9,0 quy đổi sang điểm chữ là gì và tương ứng thang 4 bao nhiêu?',
    'Điểm chữ A (từ 8,5 đến 10), tương ứng 4,0 theo thang 4.',
    ['quy-dinh-quy-doi-diem']),
  ans('ans-quydoi-dat', 'SEMANTIC_QUERY',
    'Học phần được coi là đạt khi điểm chữ từ mức nào?',
    'Từ D trở lên; riêng học phần điều kiện tốt nghiệp phải đạt từ C trở lên.',
    ['quy-dinh-quy-doi-diem', 'quy-che-tot-nghiep']),
  ans('ans-tienganh-chungchi', 'DIRECT_RETRIEVAL',
    'Những chứng chỉ tiếng Anh nào được nhà trường công nhận đạt chuẩn đầu ra?',
    'IELTS từ 4,5, TOEFL iBT từ 45, hoặc VSTEP bậc 3 do đơn vị được Bộ cho phép tổ chức thi cấp.',
    ['quy-dinh-chuan-tieng-anh'], NOISE),
  ans('ans-tienganh-mienhoc', 'SEMANTIC_QUERY',
    'Sinh viên có IELTS bao nhiêu khi nhập học thì được miễn học phần tiếng Anh tăng cường?',
    'IELTS từ 6,0 trở lên khi nhập học.',
    ['quy-dinh-chuan-tieng-anh']),
  ans('ans-tienganh-thoidiemnop', 'EXACT_IDENTIFIER',
    'Minh chứng đạt chuẩn tiếng Anh phải nộp chậm nhất khi nào?',
    'Chậm nhất trước kỳ xét tốt nghiệp một tháng.',
    ['quy-dinh-chuan-tieng-anh', 'quy-che-tot-nghiep']),
  ans('ans-hocphi-quahan-hocphan', 'SEMANTIC_QUERY',
    'Quá hạn đóng học phí mà không có lý do chính đáng thì sao?',
    'Sinh viên bị xoá tên khỏi danh sách lớp học phần.',
    ['quy-dinh-hoc-phi']),
  ans('ans-thi-kythiphu', 'DIRECT_RETRIEVAL',
    'Sinh viên vắng thi có lý do chính đáng được giải quyết thế nào?',
    'Được dự thi ở kỳ thi phụ do khoa tổ chức.',
    ['quy-che-thi']),
];

// ---------------------------------------------------------------------------
// CASE — MULTI_HOP (cần nối 2+ tài liệu)
// ---------------------------------------------------------------------------
const multiHop = [
  ans('mh-baoluu-thoigiantoida', 'MULTI_HOP',
    'Thời gian bảo lưu có bị tính vào thời gian tối đa hoàn thành chương trình không, và thời gian tối đa đó là bao nhiêu?',
    'Thời gian bảo lưu không tính vào thời gian tối đa. Thời gian tối đa bằng thời gian thiết kế của chương trình cộng thêm hai năm.',
    ['quy-che-bao-luu', 'quy-che-hoc-vu']),
  ans('mh-hocbong-kyluat', 'MULTI_HOP',
    'Sinh viên bị khiển trách trong học kỳ có được xét học bổng khuyến khích học tập không? Vì sao?',
    'Không. Học bổng yêu cầu không bị kỷ luật từ mức khiển trách; ngoài ra khiển trách khiến điểm rèn luyện không vượt loại trung bình, dưới ngưỡng 80 điểm.',
    ['quy-che-hoc-bong', 'quy-che-ky-luat', 'quy-dinh-ren-luyen']),
  ans('mh-doan-thuctap', 'MULTI_HOP',
    'Sinh viên bị điểm F học phần thực tập tốt nghiệp có được giao đồ án tốt nghiệp không?',
    'Không. Phải hoàn thành học phần thực tập tốt nghiệp mới đủ điều kiện giao đồ án; sinh viên bị F thực tập phải thực tập lại và không được xét làm đồ án cho đến khi đạt.',
    ['quy-dinh-do-an', 'quy-dinh-thuc-tap']),
  ans('mh-thi-hocphi', 'MULTI_HOP',
    'Sinh viên chưa đóng học phí đến tuần thi thì ảnh hưởng gì đến việc dự thi và danh sách lớp?',
    'Không được dự thi kết thúc học phần vì chưa hoàn thành nghĩa vụ học phí; quá bốn tuần không lý do chính đáng còn bị xoá tên khỏi lớp học phần.',
    ['quy-che-thi', 'quy-dinh-hoc-phi']),
  ans('mh-totnghiep-hoclai-xeploai', 'MULTI_HOP',
    'Sinh viên có điểm trung bình tích luỹ 3,7 nhưng phải học lại 7% số tín chỉ thì tốt nghiệp loại gì?',
    'Loại giỏi. Điểm 3,7 thuộc mức xuất sắc nhưng bị hạ một mức do khối lượng học lại vượt 5% tổng số tín chỉ.',
    ['quy-che-tot-nghiep']),
  ans('mh-tienganh-totnghiep', 'MULTI_HOP',
    'Sinh viên đủ tín chỉ và GPA 3,0 nhưng chưa nộp chứng chỉ tiếng Anh trước kỳ xét một tháng thì sao?',
    'Chưa được xét tốt nghiệp đợt đó; việc xét bị lùi sang đợt sau cho đến khi nộp minh chứng đạt chuẩn tiếng Anh bậc 3.',
    ['quy-che-tot-nghiep', 'quy-dinh-chuan-tieng-anh']),
  ans('mh-chuyennganh-gpa', 'MULTI_HOP',
    'Sinh viên năm nhất có GPA 2,3 muốn chuyển ngành vào đầu học kỳ 2 có được không?',
    'Không. Chuyển ngành yêu cầu điểm trung bình tích luỹ từ 2,5 trở lên; GPA 2,3 chưa đạt ngưỡng.',
    ['quy-dinh-chuyen-nganh', 'quy-dinh-quy-doi-diem']),
  ans('mh-renluyen-hocbong-mua', 'MULTI_HOP',
    'Điểm rèn luyện 78 thì có đủ điều kiện xét học bổng khuyến khích học tập không?',
    'Không. Học bổng yêu cầu điểm rèn luyện từ 80 trở lên; 78 điểm chỉ xếp loại khá, chưa đạt.',
    ['quy-che-hoc-bong', 'quy-dinh-ren-luyen']),
  ans('mh-baoluu-hocphi-hoantra', 'MULTI_HOP',
    'Sinh viên xin bảo lưu sau khi đã đóng học phí và rút toàn bộ học phần ở tuần thứ hai thì được hoàn học phí thế nào?',
    'Được hoàn trả 100% học phí phần đã rút vì rút trong hai tuần đầu học kỳ.',
    ['quy-che-bao-luu', 'quy-dinh-hoc-phi']),
  ans('mh-thuctap-dangky', 'MULTI_HOP',
    'Sinh viên tích luỹ 96 tín chỉ có được đăng ký học phần thực tập tốt nghiệp trong đợt đăng ký không?',
    'Không. Thực tập tốt nghiệp yêu cầu tối thiểu 100 tín chỉ tích luỹ nên chưa đủ điều kiện đăng ký.',
    ['quy-dinh-thuc-tap', 'quy-dinh-dang-ky-hoc-phan']),
  ans('mh-kyluat-renluyen-hocbong', 'MULTI_HOP',
    'Sinh viên bị cảnh cáo học kỳ này thì điểm rèn luyện và học bổng bị ảnh hưởng ra sao?',
    'Điểm rèn luyện xếp loại yếu; đồng thời không được xét học bổng và khen thưởng trong thời gian thi hành kỷ luật cảnh cáo (một năm học).',
    ['quy-che-ky-luat', 'quy-dinh-ren-luyen', 'quy-che-hoc-bong']),
  ans('mh-hocvu-tinchi-canhbao', 'MULTI_HOP',
    'Sinh viên bị cảnh báo học vụ có thể đăng ký 16 tín chỉ trong học kỳ chính không?',
    'Không. Sinh viên đang bị cảnh báo học vụ chỉ được đăng ký tối đa 14 tín chỉ.',
    ['quy-che-hoc-vu', 'quy-dinh-dang-ky-hoc-phan']),
  ans('mh-doan-thaythe', 'MULTI_HOP',
    'Sinh viên GPA 2,2 không đủ điều kiện làm đồ án thì phải làm gì để tốt nghiệp?',
    'Đăng ký học các học phần thay thế với tổng số tín chỉ tương đương do khoa quy định.',
    ['quy-dinh-do-an', 'quy-che-tot-nghiep']),
  ans('mh-phuckhao-totnghiep', 'MULTI_HOP',
    'Sau phúc khảo, một học phần điều kiện tốt nghiệp từ D lên C thì có ảnh hưởng gì đến xét tốt nghiệp?',
    'Có lợi: học phần điều kiện tốt nghiệp phải đạt từ C trở lên, nên sau phúc khảo lên C sinh viên mới thoả điều kiện này.',
    ['quy-dinh-phuc-khao', 'quy-dinh-quy-doi-diem', 'quy-che-tot-nghiep']),
  ans('mh-nghihoc-thoigiantoida', 'MULTI_HOP',
    'Thời gian nghỉ học tạm thời vì sức khoẻ có làm sinh viên vượt thời gian tối đa hoàn thành chương trình không?',
    'Quy chế học vụ chỉ loại trừ thời gian bảo lưu khỏi thời gian tối đa; thời gian nghỉ học tạm thời không được nêu là loại trừ, nên vẫn có thể tính vào.',
    ['quy-dinh-nghi-hoc-tam-thoi', 'quy-che-hoc-vu']),
  ans('mh-thi-caithien-gpa', 'MULTI_HOP',
    'Học cải thiện một học phần từ D (1,0) lên B (3,0) thì điểm nào vào GPA?',
    'Điểm B (3,0) vì là điểm cao hơn trong hai lần học; điểm này được dùng để tính điểm trung bình tích luỹ.',
    ['quy-che-thi', 'quy-dinh-quy-doi-diem']),
  ans('mh-hocbong-diemC', 'MULTI_HOP',
    'Sinh viên GPA học kỳ 3,4 nhưng có một học phần điểm C+ thì có được xét học bổng không?',
    'Được xét. Điều kiện là không có học phần dưới điểm C; C+ vẫn cao hơn C nên không vi phạm.',
    ['quy-che-hoc-bong', 'quy-dinh-quy-doi-diem']),
  ans('mh-chuyennganh-baoluu-tc', 'MULTI_HOP',
    'Khi chuyển ngành, các học phần đã học có được giữ lại không và ai quyết định?',
    'Được bảo lưu nếu tương đương với học phần trong chương trình ngành mới, do khoa tiếp nhận xét công nhận.',
    ['quy-dinh-chuyen-nganh', 'quy-dinh-quy-doi-diem']),
];

// ---------------------------------------------------------------------------
// CASE — CONFLICTING_SOURCES
// ---------------------------------------------------------------------------
const conflicting = [
  ans('conflict-baoluu-thoigian', 'CONFLICTING_SOURCES',
    'Thời gian bảo lưu kết quả học tập tối đa là bao nhiêu học kỳ?',
    'Có mâu thuẫn giữa hai tài liệu: Quy chế 2023 nêu tối đa hai học kỳ liên tiếp, còn Thông báo sửa đổi 2024 nêu tối đa một học kỳ (áp dụng từ 2024-2025).',
    ['quy-che-bao-luu-2023', 'thong-bao-bao-luu-2024']),
  ans('conflict-hocphi-han-nop', 'CONFLICTING_SOURCES',
    'Hạn đóng học phí là mấy tuần kể từ khi học kỳ bắt đầu?',
    'Có mâu thuẫn: Hướng dẫn học vụ nêu bốn tuần, còn Thông báo tài chính nêu ba tuần kể từ ngày bắt đầu học kỳ.',
    ['huong-dan-hoc-vu', 'thong-bao-tai-chinh']),
  ans('conflict-gpa-totnghiep', 'CONFLICTING_SOURCES',
    'Điểm trung bình tích luỹ tối thiểu để xét tốt nghiệp là bao nhiêu?',
    'Có mâu thuẫn giữa hai văn bản: Quy định 2022 nêu từ 2,0, còn Quy định sửa đổi 2025 nêu từ 2,5 (áp dụng từ khoá tuyển sinh 2025).',
    ['quy-dinh-gpa-tot-nghiep-2022', 'quy-dinh-gpa-tot-nghiep-2025']),
  ans('conflict-baoluu-vs-quyche', 'CONFLICTING_SOURCES',
    'Sinh viên được bảo lưu tối đa mấy học kỳ theo các văn bản hiện có?',
    'Các văn bản không thống nhất: Quy chế bảo lưu (bản đầy đủ) và Quy chế 2023 nêu tối đa hai học kỳ, trong khi Thông báo sửa đổi 2024 rút xuống một học kỳ.',
    ['quy-che-bao-luu', 'thong-bao-bao-luu-2024']),
  ans('conflict-hocphi-hoantra-vs-hocvu', 'CONFLICTING_SOURCES',
    'Hạn đóng học phí theo Quy định học phí và theo Thông báo tài chính có giống nhau không?',
    'Không giống nhau: Quy định học phí nêu bốn tuần kể từ ngày bắt đầu học kỳ, còn Thông báo tài chính nêu ba tuần.',
    ['quy-dinh-hoc-phi', 'thong-bao-tai-chinh']),
  ans('conflict-gpa-vs-quyche-totnghiep', 'CONFLICTING_SOURCES',
    'Ngưỡng GPA xét tốt nghiệp theo Quy chế xét tốt nghiệp và theo Quy định sửa đổi 2025 là bao nhiêu?',
    'Mâu thuẫn: Quy chế xét tốt nghiệp nêu từ 2,0, còn Quy định sửa đổi 2025 nâng lên từ 2,5 cho khoá tuyển sinh 2025.',
    ['quy-che-tot-nghiep', 'quy-dinh-gpa-tot-nghiep-2025']),
];

// ---------------------------------------------------------------------------
// CASE — UNANSWERABLE (ngoài phạm vi corpus)
// ---------------------------------------------------------------------------
const unanswerable = [
  noAns('un-ktx-gia', 'UNANSWERABLE',
    'Giá thuê một chỗ ở ký túc xá mỗi tháng là bao nhiêu?',
    ['quy-che-bao-luu', 'quy-dinh-hoc-phi', 'quy-dinh-nghi-hoc-tam-thoi']),
  noAns('un-giangvien-nghiphep', 'UNANSWERABLE',
    'Giảng viên được nghỉ phép năm bao nhiêu ngày?',
    ['quy-che-thi', 'quy-che-hoc-vu']),
  noAns('un-gui-xe', 'UNANSWERABLE',
    'Phí gửi xe máy trong khuôn viên trường là bao nhiêu một lượt?',
    ['quy-dinh-hoc-phi', 'quy-che-ky-luat']),
  noAns('un-clb-bongda', 'UNANSWERABLE',
    'Câu lạc bộ bóng đá của trường tập luyện vào những ngày nào?',
    ['quy-dinh-ren-luyen', 'quy-che-hoc-bong']),
  noAns('un-thuvien-giomocua', 'UNANSWERABLE',
    'Thư viện trường mở cửa đến mấy giờ vào cuối tuần?',
    ['quy-dinh-nghi-hoc-tam-thoi', 'quy-dinh-phuc-khao']),
  noAns('un-canteen-menu', 'UNANSWERABLE',
    'Nhà ăn sinh viên có phục vụ suất ăn chay không?',
    ['quy-che-bao-luu', 'quy-che-tot-nghiep']),
  noAns('un-hocbong-doanhnghiep', 'UNANSWERABLE',
    'Học bổng tài trợ của công ty ABC năm nay có mấy suất?',
    ['quy-che-hoc-bong', 'quy-dinh-ren-luyen']),
  noAns('un-thoitiet', 'UNANSWERABLE',
    'Ngày mai trời có mưa để nghỉ học không?',
    ['quy-che-hoc-vu']),
  noAns('un-hocphi-nam-cu-the', 'UNANSWERABLE',
    'Đơn giá một tín chỉ năm học 2026-2027 là bao nhiêu đồng?',
    ['quy-dinh-hoc-phi', 'quy-dinh-quy-doi-diem']),
  noAns('un-ky-tuc-xa-dieukien', 'UNANSWERABLE',
    'Điều kiện ưu tiên xét ở ký túc xá gồm những gì?',
    ['quy-dinh-nghi-hoc-tam-thoi', 'quy-che-bao-luu']),
  noAns('un-diemA-thang10', 'UNANSWERABLE',
    'Trường có áp dụng làm tròn điểm học phần lên 0,25 không?',
    ['quy-dinh-quy-doi-diem', 'quy-che-thi']),
  noAns('un-doi-lich-thi', 'UNANSWERABLE',
    'Làm sao để xin đổi phòng thi sang cơ sở gần nhà hơn?',
    ['quy-che-thi', 'quy-dinh-phuc-khao']),
  noAns('un-wifi', 'UNANSWERABLE',
    'Mật khẩu wifi khu giảng đường B là gì?',
    ['quy-che-hoc-vu', 'quy-dinh-dang-ky-hoc-phan']),
  noAns('un-le-tot-nghiep', 'UNANSWERABLE',
    'Lễ tốt nghiệp năm nay tổ chức ở đâu và ngày nào?',
    ['quy-che-tot-nghiep', 'quy-dinh-do-an']),
  noAns('un-bao-hiem-yte', 'UNANSWERABLE',
    'Mức đóng bảo hiểm y tế sinh viên một năm là bao nhiêu?',
    ['quy-dinh-hoc-phi', 'quy-dinh-nghi-hoc-tam-thoi']),
];

// ---------------------------------------------------------------------------
// CASE — ADVERSARIAL (tiền đề sai / con số bịa / điều kiện không tồn tại)
// ---------------------------------------------------------------------------
const adversarial = [
  noAns('adv-baoluu-3ky', 'ADVERSARIAL',
    'Vì sinh viên được bảo lưu tối đa ba học kỳ, thủ tục xin gia hạn học kỳ thứ ba như thế nào?',
    ['quy-che-bao-luu', 'quy-che-hoc-vu']),
  noAns('adv-hocphi-codinh', 'ADVERSARIAL',
    'Quy định nói học phí cố định 100 triệu đồng mỗi năm, đúng không?',
    ['quy-dinh-hoc-phi']),
  noAns('adv-ielts-65', 'ADVERSARIAL',
    'Điều kiện tốt nghiệp yêu cầu IELTS tối thiểu 6.5 phải không, và nộp ở đâu?',
    ['quy-che-tot-nghiep', 'quy-dinh-chuan-tieng-anh']),
  noAns('adv-phuckhao-2ngay', 'ADVERSARIAL',
    'Hạn nộp đơn phúc khảo chỉ có 2 ngày, làm sao nộp kịp trong 24 giờ?',
    ['quy-dinh-phuc-khao']),
  noAns('adv-vang-50', 'ADVERSARIAL',
    'Vì được phép vắng tới 50% số tiết, sinh viên vắng 45% vẫn thi bình thường đúng không?',
    ['quy-che-thi']),
  noAns('adv-canhbao-1ky-thoihoc', 'ADVERSARIAL',
    'Bị cảnh báo học vụ một học kỳ là bị buộc thôi học ngay, đúng không?',
    ['quy-che-hoc-vu']),
  noAns('adv-chuyennganh-3lan', 'ADVERSARIAL',
    'Sinh viên được chuyển ngành ba lần, vậy lần thứ ba cần hồ sơ gì?',
    ['quy-dinh-chuyen-nganh']),
  noAns('adv-hocbong-100suat', 'ADVERSARIAL',
    'Mỗi ngành có đúng 100 suất học bổng khuyến khích học tập mỗi kỳ, danh sách ở đâu?',
    ['quy-che-hoc-bong']),
  noAns('adv-thuctap-2tuan', 'ADVERSARIAL',
    'Thực tập tốt nghiệp chỉ cần 2 tuần, vậy có thể làm trong kỳ nghỉ hè ngắn đúng không?',
    ['quy-dinh-thuc-tap']),
  noAns('adv-doan-khong-cananhuong', 'ADVERSARIAL',
    'Vì đồ án tốt nghiệp không yêu cầu điều kiện tín chỉ, sinh viên năm hai làm luôn được chứ?',
    ['quy-dinh-do-an']),
  noAns('adv-rut-hocphan-tuan10', 'ADVERSARIAL',
    'Nhà trường cho rút học phần đến tuần thứ 10, vậy tôi rút bây giờ có kịp không?',
    ['quy-dinh-dang-ky-hoc-phan']),
  noAns('adv-kyluat-xoa-ngay', 'ADVERSARIAL',
    'Quyết định kỷ luật cảnh cáo được xoá ngay sau một tháng phải không?',
    ['quy-che-ky-luat']),
  noAns('adv-renluyen-thang-10', 'ADVERSARIAL',
    'Điểm rèn luyện chấm theo thang 10 và 7 điểm là loại tốt đúng không?',
    ['quy-dinh-ren-luyen']),
  noAns('adv-phuckhao-lan2', 'ADVERSARIAL',
    'Tôi muốn phúc khảo lần hai cùng một bài thi thì nộp đơn ở đâu?',
    ['quy-dinh-phuc-khao']),
  noAns('adv-nghihoc-4ky', 'ADVERSARIAL',
    'Được nghỉ học tạm thời tới bốn học kỳ vì lý do cá nhân, thủ tục gia hạn thế nào?',
    ['quy-dinh-nghi-hoc-tam-thoi']),
];

// ---------------------------------------------------------------------------
// PATCH — requiredFacts / forbiddenClaims cho một số case cốt lõi (PROMPT §11-12).
// Đặt riêng để không phình lời gọi ans()/noAns(). Câu trả lời chỉ ĐÚNG khi chứa
// đủ requiredFacts; forbiddenClaims lộ ra = hallucination.
// ---------------------------------------------------------------------------
const PATCHES = {
  'mh-hocbong-kyluat': {
    requiredFacts: ['không bị kỷ luật từ mức khiển trách', 'điểm rèn luyện không vượt loại trung bình'],
    forbiddenClaims: ['vẫn được xét học bổng', 'khiển trách không ảnh hưởng học bổng'],
  },
  'mh-doan-thuctap': {
    requiredFacts: ['phải hoàn thành học phần thực tập tốt nghiệp', 'không được xét làm đồ án cho đến khi đạt'],
    forbiddenClaims: ['vẫn được giao đồ án', 'điểm F thực tập không ảnh hưởng đồ án'],
  },
  'mh-totnghiep-hoclai-xeploai': {
    requiredFacts: ['loại giỏi', 'hạ một mức', 'học lại vượt 5%'],
    forbiddenClaims: ['loại xuất sắc', 'không bị hạ mức'],
  },
  'mh-thi-hocphi': {
    requiredFacts: ['không được dự thi', 'chưa hoàn thành nghĩa vụ học phí'],
    forbiddenClaims: ['vẫn được dự thi bình thường'],
  },
  'conflict-baoluu-thoigian': {
    requiredFacts: ['hai học kỳ', 'một học kỳ', 'mâu thuẫn'],
    forbiddenClaims: ['ba học kỳ', 'không có mâu thuẫn'],
  },
  'conflict-hocphi-han-nop': {
    requiredFacts: ['bốn tuần', 'ba tuần', 'mâu thuẫn'],
    forbiddenClaims: ['năm tuần', 'thống nhất'],
  },
  'adv-baoluu-3ky': { forbiddenClaims: ['bảo lưu tối đa ba học kỳ', 'thủ tục gia hạn học kỳ thứ ba'] },
  'adv-hocphi-codinh': { forbiddenClaims: ['học phí cố định 100 triệu đồng mỗi năm', 'đúng'] },
  'adv-ielts-65': { forbiddenClaims: ['IELTS tối thiểu 6.5', 'yêu cầu IELTS 6.5'] },
  'adv-vang-50': { forbiddenClaims: ['được phép vắng tới 50% số tiết', 'vắng 45% vẫn thi bình thường'] },
  'adv-phuckhao-2ngay': { forbiddenClaims: ['hạn nộp đơn phúc khảo chỉ có 2 ngày', 'nộp trong 24 giờ'] },
  'adv-canhbao-1ky-thoihoc': { forbiddenClaims: ['bị cảnh báo học vụ một học kỳ là buộc thôi học ngay'] },
  'adv-chuyennganh-3lan': { forbiddenClaims: ['được chuyển ngành ba lần', 'hồ sơ cho lần chuyển ngành thứ ba'] },
  'adv-hocbong-100suat': { forbiddenClaims: ['mỗi ngành có đúng 100 suất học bổng'] },
  'adv-thuctap-2tuan': { forbiddenClaims: ['thực tập tốt nghiệp chỉ cần 2 tuần'] },
  'adv-doan-khong-cananhuong': { forbiddenClaims: ['đồ án tốt nghiệp không yêu cầu điều kiện tín chỉ', 'sinh viên năm hai làm đồ án'] },
  'adv-rut-hocphan-tuan10': { forbiddenClaims: ['cho rút học phần đến tuần thứ 10'] },
  'adv-kyluat-xoa-ngay': { forbiddenClaims: ['kỷ luật cảnh cáo được xoá ngay sau một tháng'] },
  'adv-renluyen-thang-10': { forbiddenClaims: ['điểm rèn luyện chấm theo thang 10', '7 điểm là loại tốt'] },
  'adv-phuckhao-lan2': { forbiddenClaims: ['được phúc khảo lần hai cùng một bài thi'] },
  'adv-nghihoc-4ky': { forbiddenClaims: ['nghỉ học tạm thời tới bốn học kỳ vì lý do cá nhân'] },
};

// ---------------------------------------------------------------------------
// GHI FILE
// ---------------------------------------------------------------------------
const FILES = {
  answerable,
  'multi-hop': multiHop,
  conflicting,
  unanswerable,
  adversarial,
};

for (const cases of Object.values(FILES)) {
  for (const c of cases) {
    const p = PATCHES[c.id];
    if (p) Object.assign(c, p);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
const seenIds = new Set();
for (const [name, cases] of Object.entries(FILES)) {
  for (const c of cases) {
    if (seenIds.has(c.id)) throw new Error(`id trùng: ${c.id}`);
    seenIds.add(c.id);
    if (c.answerable !== (c.expectedAnswer !== null)) {
      throw new Error(`answerable/expectedAnswer lệch: ${c.id}`);
    }
    for (const s of c.expectedDocuments) {
      if (!c.corpus.some((d) => d.source === s)) {
        throw new Error(`${c.id}: expectedDocuments "${s}" không có trong corpus`);
      }
    }
  }
  const lines = cases.map((c) => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(resolve(OUT_DIR, `${name}.jsonl`), lines, 'utf8');
  console.log(`${name}.jsonl: ${cases.length} case`);
  total += cases.length;
}
console.log(`TỔNG: ${total} case, ${Object.keys(CORPUS).length} tài liệu corpus`);
