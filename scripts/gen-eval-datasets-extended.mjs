#!/usr/bin/env node
/**
 * Sinh các golden dataset MỞ RỘNG (PHASE 19) — bổ sung cho
 * `scripts/gen-eval-datasets.mjs`. Tách file để không phình generator gốc và
 * để corpus kỹ thuật (hệ thống nội bộ) không lẫn với corpus quy chế.
 *
 * Chạy: `node scripts/gen-eval-datasets-extended.mjs` (hoặc `npm run dataset:generate`).
 *
 * File sinh ra (evaluation/datasets/):
 *   semantic.jsonl              — paraphrase + keyword-mismatch (retrieval ngữ nghĩa)
 *   numerical.jsonl             — số/port/version/ngày + temporal reasoning
 *   cross-document.jsonl        — trả lời cần ghép >= 3 tài liệu
 *   entity-disambiguation.jsonl — thực thể tên gần giống, dễ lấy nhầm
 *   distractor.jsonl            — có tài liệu nhiễu gần giống gold + long-context
 *   vietnamese-robustness.jsonl — typo / thiếu dấu / trộn Anh-Việt / khẩu ngữ / viết tắt
 *   agent-routing.jsonl         — RAG vs tool vs rag_and_tool (PROMPT §18)
 *   golden.jsonl                — ~24 case chất lượng cao, regression suite
 *
 * Nội dung MÔ PHỎNG cho mục đích đánh giá, KHÔNG phải văn bản/hệ thống thật.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS as SHARED } from './eval-corpus.mjs';

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../evaluation/datasets',
);

// ===========================================================================
// THƯ VIỆN CORPUS
// ===========================================================================
const CORPUS = {
  ...SHARED,

  // --- Thực thể tên gần giống (entity disambiguation) ----------------------
  'quy-dinh-thuc-tap-cntt': {
    title: 'Quy định thực tập — Khoa Công nghệ Thông tin (CNTT)',
    text: `# Quy định thực tập tốt nghiệp — Khoa Công nghệ Thông tin

## Điều 1. Điều kiện
Sinh viên Khoa Công nghệ Thông tin đăng ký thực tập tốt nghiệp khi đã tích luỹ tối thiểu 100 tín chỉ.

## Điều 2. Thời lượng
Thực tập của Khoa Công nghệ Thông tin kéo dài mười tuần liên tục tại doanh nghiệp phần mềm, tương đương 5 tín chỉ.

## Điều 3. Sản phẩm
Kết thúc thực tập, sinh viên nộp mã nguồn và báo cáo kỹ thuật, bảo vệ trước hội đồng bộ môn.`,
  },
  'quy-dinh-thuc-tap-cntp': {
    title: 'Quy định thực tập — Khoa Công nghệ Thực phẩm (CNTP)',
    text: `# Quy định thực tập tốt nghiệp — Khoa Công nghệ Thực phẩm

## Điều 1. Điều kiện
Sinh viên Khoa Công nghệ Thực phẩm đăng ký thực tập tốt nghiệp khi đã tích luỹ tối thiểu 95 tín chỉ.

## Điều 2. Thời lượng
Thực tập của Khoa Công nghệ Thực phẩm kéo dài tám tuần liên tục tại nhà máy chế biến, tương đương 4 tín chỉ.

## Điều 3. An toàn
Sinh viên phải hoàn thành khoá tập huấn an toàn vệ sinh thực phẩm trước khi xuống nhà máy.`,
  },
  'chuc-nang-phong-dao-tao': {
    title: 'Chức năng, nhiệm vụ Phòng Đào tạo',
    text: `# Chức năng, nhiệm vụ Phòng Đào tạo

Phòng Đào tạo quản lý kế hoạch giảng dạy, thời khoá biểu, đăng ký học phần, xét điều kiện dự thi và tổ chức xét tốt nghiệp. Phòng Đào tạo tiếp nhận đơn bảo lưu, đơn phúc khảo và đơn chuyển ngành.`,
  },
  'chuc-nang-phong-ctsv': {
    title: 'Chức năng, nhiệm vụ Phòng Công tác Sinh viên',
    text: `# Chức năng, nhiệm vụ Phòng Công tác Sinh viên

Phòng Công tác Sinh viên quản lý hồ sơ sinh viên, đánh giá kết quả rèn luyện, xét học bổng và trợ cấp xã hội, quản lý ký túc xá và công tác cố vấn học tập. Phòng Công tác Sinh viên KHÔNG tiếp nhận đơn phúc khảo hay đăng ký học phần.`,
  },
  'hoi-dong-khoa-hoc': {
    title: 'Quy chế Hội đồng Khoa học và Đào tạo',
    text: `# Quy chế Hội đồng Khoa học và Đào tạo

Hội đồng Khoa học và Đào tạo tư vấn cho hiệu trưởng về chương trình đào tạo, mở ngành, và phê duyệt đề xuất đề tài nghiên cứu của sinh viên ở cấp cuối cùng. Hội đồng họp định kỳ mỗi quý.`,
  },
  'hoi-dong-tuyen-sinh': {
    title: 'Quy chế Hội đồng Tuyển sinh',
    text: `# Quy chế Hội đồng Tuyển sinh

Hội đồng Tuyển sinh xây dựng đề án tuyển sinh, xác định chỉ tiêu và điểm chuẩn, tổ chức xét và công bố kết quả trúng tuyển. Hội đồng Tuyển sinh không tham gia phê duyệt đề tài nghiên cứu.`,
  },

  // --- Hệ thống nội bộ HTQLĐT (numerical / temporal / keyword-mismatch) ----
  'htqldt-kien-truc-2023': {
    title: 'HTQLĐT — Kiến trúc hệ thống, phiên bản 1.0 (ban hành 01/2023)',
    text: `# Hệ thống Quản lý Đào tạo (HTQLĐT) — Kiến trúc phiên bản 1.0

Tài liệu ban hành tháng 01/2023.

## 1. Cơ sở dữ liệu
Cơ sở dữ liệu chính của HTQLĐT phiên bản 1.0 dùng MySQL 8.0.

## 2. Bộ nhớ đệm
Lớp cache dùng Redis chạy trên cổng 6379.

## 3. Hàng đợi công việc
Hàng đợi xử lý nền dùng RabbitMQ.`,
  },
  'htqldt-kien-truc-2025': {
    title: 'HTQLĐT — Kiến trúc hệ thống, phiên bản 2.0 (ban hành 03/2025)',
    text: `# Hệ thống Quản lý Đào tạo (HTQLĐT) — Kiến trúc phiên bản 2.0

Tài liệu ban hành tháng 03/2025, thay thế phiên bản 1.0.

## 1. Cơ sở dữ liệu
Từ phiên bản 2.0, cơ sở dữ liệu chính chuyển sang PostgreSQL 16 kèm extension pgvector để lưu embedding.

## 2. Bộ nhớ đệm
Redis được chuyển sang cổng 6380 để tách khỏi cụm cũ.

## 3. Hàng đợi công việc
Hàng đợi chuyển từ RabbitMQ sang BullMQ chạy trên chính Redis.`,
  },
  'htqldt-van-hanh': {
    title: 'HTQLĐT — Thông số vận hành',
    text: `# HTQLĐT — Thông số vận hành và giới hạn

## Giới hạn tải lên
Mỗi tài liệu tải lên tối đa 20 MB.

## Cấu hình truy hồi
Top-K mặc định khi truy hồi là 20 ứng viên; sau bước rerank giữ lại 5.
Số chiều vector embedding là 1024.

## Thời gian chờ
Thời gian chờ (timeout) mỗi lời gọi mô hình ngôn ngữ là 30 giây.

## Tài nguyên
RAM tối thiểu cho máy chủ ứng dụng là 16 GB. Mục tiêu độ trễ p95 của truy vấn là 2000 mili giây.`,
  },
  'htqldt-dong-bo': {
    title: 'HTQLĐT — Xử lý sửa đồng thời',
    text: `# HTQLĐT — Xử lý sửa đồng thời một bản ghi

Khi hai người dùng cùng mở và lưu một bản ghi, HTQLĐT áp dụng cơ chế khoá lạc quan (optimistic locking) dựa trên cột \`version\` của bản ghi. Mỗi lần lưu, hệ thống so \`version\` gửi lên với \`version\` hiện tại trong cơ sở dữ liệu; nếu không khớp, thao tác lưu bị từ chối và người dùng phải tải lại bản mới nhất rồi nhập lại thay đổi. Hệ thống không dùng khoá bi quan (pessimistic lock) để tránh giữ khoá lâu.`,
  },
  'htqldt-xac-thuc': {
    title: 'HTQLĐT — Xác thực và phân quyền',
    text: `# HTQLĐT — Xác thực và phân quyền

## Đăng nhập
HTQLĐT xác thực bằng tài khoản nội bộ và mật khẩu. Hệ thống hỗ trợ đăng nhập một lần (SSO) qua giao thức OIDC với cổng định danh của trường.

## Phân quyền
HTQLĐT dùng mô hình phân quyền theo vai trò (RBAC) với bốn vai trò: sinh viên, giảng viên, trưởng khoa, quản trị hệ thống.`,
  },
  'htqldt-pham-vi-khoa': {
    title: 'HTQLĐT — Phạm vi dữ liệu theo khoa',
    text: `# HTQLĐT — Phạm vi dữ liệu theo khoa

Vai trò trưởng khoa chỉ đọc và thao tác được trên dữ liệu của sinh viên thuộc khoa mình quản lý. Trưởng khoa không truy cập được dữ liệu sinh viên của khoa khác. Vai trò quản trị hệ thống không bị giới hạn phạm vi.`,
  },

  // --- Quy trình duyệt (distractor / cross-document / multi-hop) -----------
  'quy-trinh-duyet-de-tai': {
    title: 'Quy trình phê duyệt đề xuất đề tài nghiên cứu sinh viên (hiện hành)',
    text: `# Quy trình phê duyệt đề xuất đề tài nghiên cứu của sinh viên

Áp dụng từ năm học 2024-2025.

Đề xuất đề tài nghiên cứu của sinh viên được phê duyệt qua ba cấp theo trình tự:
1. Khoa quản lý ngành xét và duyệt trước.
2. Phòng Đào tạo duyệt sau khi có ý kiến của Khoa.
3. Hội đồng Khoa học và Đào tạo phê duyệt ở cấp cuối cùng.

Đề xuất chỉ được coi là hoàn tất khi có phê duyệt của cả ba cấp.`,
  },
  'quy-trinh-duyet-de-tai-cu': {
    title: 'Quy trình phê duyệt đề xuất đề tài (bản cũ, trước 2024) — ĐÃ HẾT HIỆU LỰC',
    text: `# Quy trình phê duyệt đề xuất đề tài (bản cũ)

Áp dụng đến hết năm học 2023-2024, nay đã được thay thế.

Trình tự cũ gồm ba bước: Phòng Đào tạo duyệt trước, sau đó Khoa cho ý kiến, cuối cùng Hội đồng Khoa học phê duyệt.`,
  },
  'quy-trinh-duyet-kinh-phi': {
    title: 'Quy trình phê duyệt kinh phí hoạt động sinh viên',
    text: `# Quy trình phê duyệt kinh phí hoạt động của sinh viên

Đề xuất kinh phí cho hoạt động sinh viên được duyệt theo trình tự: Phòng Kế hoạch — Tài chính thẩm định trước, sau đó Ban Giám hiệu phê duyệt, cuối cùng Khoa nhận thông báo để triển khai. Quy trình này chỉ áp dụng cho kinh phí, không áp dụng cho đề tài nghiên cứu.`,
  },

  // --- Long context: sổ tay sinh viên (một fact quan trọng chôn ở giữa) ----
  'so-tay-sinh-vien-2025': {
    title: 'Sổ tay sinh viên 2025 (trích)',
    text: `# Sổ tay sinh viên 2025

## 1. Lời nói đầu
Sổ tay này tổng hợp các thông tin thường dùng cho sinh viên trong năm học 2025-2026. Nội dung chi tiết xem các quy chế, quy định riêng.

## 2. Lịch năm học
Năm học gồm hai học kỳ chính và một học kỳ hè tự chọn. Học kỳ 1 thường bắt đầu vào đầu tháng 9, học kỳ 2 vào đầu tháng 2. Lịch cụ thể do Phòng Đào tạo công bố trước mỗi năm học.

## 3. Thư viện
Thư viện phục vụ từ thứ Hai đến thứ Bảy. Sinh viên mượn tối đa năm đầu sách một lần, thời hạn mười bốn ngày, gia hạn tối đa hai lần nếu sách không có người đặt trước.

## 4. Hỗ trợ kỹ thuật
Đường dây nóng hỗ trợ kỹ thuật của Trung tâm Công nghệ Thông tin trực trong giờ hành chính. Số điện thoại đường dây nóng hỗ trợ kỹ thuật là 1900 1088. Khi báo sự cố, sinh viên cung cấp mã số sinh viên và mô tả ngắn gọn hiện tượng.

## 5. Câu lạc bộ
Trường có hơn ba mươi câu lạc bộ học thuật và sở thích. Danh sách và lịch sinh hoạt đăng trên cổng thông tin sinh viên, cập nhật đầu mỗi học kỳ.

## 6. Y tế học đường
Phòng y tế sơ cấp cứu ban đầu và cấp giấy nghỉ ốm không quá ba ngày. Trường hợp cần nghỉ dài hơn, sinh viên nộp giấy của cơ sở y tế tuyến trên cho Phòng Đào tạo.

## 7. Rời trường
Khi tốt nghiệp hoặc thôi học, sinh viên phải hoàn tất thủ tục thanh toán với thư viện và ký túc xá trước khi nhận bằng hoặc hồ sơ gốc.`,
  },
};

// ===========================================================================
// HỖ TRỢ
// ===========================================================================
const seenIds = new Set();

function corpusOf(sources) {
  return [...new Set(sources)].map((s) => {
    const d = CORPUS[s];
    if (!d) throw new Error(`Thiếu corpus source: ${s}`);
    return { title: d.title, source: s, text: d.text };
  });
}

/**
 * Khai báo một case gọn. `o` gồm: id, type, category, question, answer|null,
 * docs (gold), also (alternative), distract, corpusExtra, requiredFacts,
 * forbiddenClaims, acceptableAnswers, difficulty, reasoningSteps, language,
 * negativeType, expectedAction, metadata.
 */
function C(o) {
  const answerable = o.answer !== null && o.answer !== undefined;
  const docs = o.docs ?? [];
  const also = o.also ?? [];
  const distract = o.distract ?? [];
  const raw = {
    id: o.id,
    type: o.type,
    question: o.question,
    answerable,
    expectedAnswer: answerable ? o.answer : null,
    acceptableAnswers: o.acceptableAnswers ?? [],
    expectedDocuments: docs,
    alternativeDocuments: also,
    distractorDocuments: distract,
    requiredFacts: o.requiredFacts ?? [],
    forbiddenClaims: o.forbiddenClaims ?? [],
    shouldAbstain: answerable ? false : (o.shouldAbstain ?? true),
    category: o.category,
    difficulty: o.difficulty ?? 'medium',
    reasoningSteps: o.reasoningSteps ?? 1,
    language: o.language ?? 'vi',
    negativeType: answerable ? null : (o.negativeType ?? 'completely_unknown'),
    expectedAction: o.expectedAction ?? null,
    metadata: o.metadata ?? {},
    corpus: corpusOf([
      ...docs,
      ...also,
      ...distract,
      ...(o.corpusExtra ?? []),
    ]),
  };
  // Kiểm tra cấu trúc cơ bản (schema Zod đầy đủ chạy ở `npm run dataset:validate`).
  if (seenIds.has(o.id)) throw new Error(`id trùng: ${o.id}`);
  seenIds.add(o.id);
  if (raw.answerable !== (raw.expectedAnswer !== null)) {
    throw new Error(`${o.id}: answerable/expectedAnswer lệch`);
  }
  if (raw.answerable && raw.shouldAbstain) {
    throw new Error(`${o.id}: answerable=true không thể shouldAbstain`);
  }
  for (const s of [...docs, ...also, ...distract]) {
    if (!raw.corpus.some((d) => d.source === s)) {
      throw new Error(`${o.id}: "${s}" không có trong corpus`);
    }
  }
  for (const s of distract) {
    if (docs.includes(s)) throw new Error(`${o.id}: "${s}" vừa gold vừa distractor`);
  }
  if (raw.expectedAction !== null && o.category !== 'agent_routing') {
    throw new Error(`${o.id}: expectedAction chỉ dùng cho agent_routing`);
  }
  return raw;
}

const NOISE_UNI = ['quy-che-thi', 'quy-dinh-hoc-phi', 'quy-che-hoc-bong'];
const NOISE_SYS = ['htqldt-van-hanh', 'htqldt-xac-thuc'];

// ===========================================================================
// semantic.jsonl — paraphrase + keyword_mismatch
// ===========================================================================
const semantic = [
  C({
    id: 'sem-baoluu-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Sinh viên có được tạm dừng việc học rồi quay lại sau không, và tối đa bao lâu?',
    answer: 'Có. Sinh viên được bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học.',
    docs: ['quy-che-bao-luu'],
    corpusExtra: NOISE_UNI,
    requiredFacts: ['hai học kỳ liên tiếp'],
  }),
  C({
    id: 'sem-hocphi-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Nếu bỏ một môn ở tuần thứ tư thì lấy lại được bao nhiêu tiền học?',
    answer: 'Được hoàn trả 50% học phí phần đã rút (rút từ tuần thứ ba đến tuần thứ sáu).',
    docs: ['quy-dinh-hoc-phi'],
    requiredFacts: ['50%'],
    forbiddenClaims: ['hoàn trả 100%'],
  }),
  C({
    id: 'sem-hocbong-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Muốn được nhận trợ cấp khuyến khích học tập thì điểm số phải như thế nào?',
    answer: 'Điểm trung bình học kỳ từ 3,2 trở lên theo thang 4 và điểm rèn luyện từ 80 trở lên, không có học phần dưới điểm C.',
    docs: ['quy-che-hoc-bong'],
    also: ['quy-dinh-ren-luyen'],
    requiredFacts: ['3,2', '80'],
  }),
  C({
    id: 'sem-tienganh-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Trước khi ra trường sinh viên cần trình độ ngoại ngữ ở mức nào?',
    answer: 'Tiếng Anh bậc 3/6 theo Khung năng lực ngoại ngữ Việt Nam hoặc chứng chỉ quốc tế tương đương còn hiệu lực hai năm.',
    docs: ['quy-dinh-chuan-tieng-anh'],
    requiredFacts: ['bậc 3'],
  }),
  C({
    id: 'sem-thi-vang-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Nghỉ học nhiều thì có bị cấm thi cuối kỳ không?',
    answer: 'Có. Vắng quá 20% số tiết của học phần thì không được dự thi kết thúc học phần đó.',
    docs: ['quy-che-thi'],
    requiredFacts: ['20%'],
  }),
  C({
    id: 'sem-renluyen-paraphrase',
    type: 'SEMANTIC_QUERY',
    category: 'semantic_paraphrase',
    question: 'Bao nhiêu điểm hạnh kiểm thì được coi là loại tốt?',
    answer: 'Điểm rèn luyện từ 80 đến dưới 90 xếp loại tốt.',
    docs: ['quy-dinh-ren-luyen'],
    requiredFacts: ['80', '90'],
  }),
  C({
    id: 'sem-locking-keyword-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Hệ thống xử lý thế nào khi hai người cùng lúc chỉnh sửa một bản ghi?',
    answer: 'HTQLĐT dùng khoá lạc quan (optimistic locking) dựa trên cột version: nếu version không khớp khi lưu, thao tác bị từ chối và người dùng phải tải lại rồi nhập lại.',
    docs: ['htqldt-dong-bo'],
    corpusExtra: NOISE_SYS,
    difficulty: 'hard',
    requiredFacts: ['khoá lạc quan', 'version', 'bị từ chối'],
  }),
  C({
    id: 'sem-sso-keyword-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Người dùng có thể đăng nhập một lần rồi vào được nhiều hệ thống không?',
    answer: 'Có. HTQLĐT hỗ trợ đăng nhập một lần (SSO) qua giao thức OIDC với cổng định danh của trường.',
    docs: ['htqldt-xac-thuc'],
    requiredFacts: ['SSO', 'OIDC'],
  }),
  C({
    id: 'sem-rerank-keyword-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Sau khi lọc lại thứ hạng thì giữ lại mấy đoạn văn bản để đưa vào mô hình?',
    answer: 'Sau bước rerank giữ lại 5 ứng viên (từ 20 ứng viên truy hồi ban đầu).',
    docs: ['htqldt-van-hanh'],
    difficulty: 'hard',
    requiredFacts: ['5'],
  }),
  C({
    id: 'sem-phong-daotao-keyword-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Đơn xin chấm lại bài thi thì nộp ở bộ phận nào?',
    answer: 'Phòng Đào tạo — bộ phận tiếp nhận đơn phúc khảo, đơn bảo lưu và đơn chuyển ngành.',
    docs: ['chuc-nang-phong-dao-tao'],
    distract: ['chuc-nang-phong-ctsv'],
    requiredFacts: ['Phòng Đào tạo'],
    forbiddenClaims: ['Phòng Công tác Sinh viên tiếp nhận đơn phúc khảo'],
  }),
  C({
    id: 'sem-baoluu-quyenloi-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Đang trong thời gian tạm nghỉ có được thi không?',
    answer: 'Không. Trong thời gian bảo lưu sinh viên không được đăng ký học phần và không được dự thi.',
    docs: ['quy-che-bao-luu'],
    requiredFacts: ['không được dự thi'],
  }),
  C({
    id: 'sem-queue-temporal-mismatch',
    type: 'SEMANTIC_QUERY',
    category: 'keyword_mismatch',
    question: 'Công việc chạy nền của hệ thống hiện được xếp hàng bằng công nghệ gì?',
    answer: 'Từ phiên bản 2.0 (03/2025), hàng đợi dùng BullMQ chạy trên Redis (trước đó là RabbitMQ).',
    docs: ['htqldt-kien-truc-2025'],
    distract: ['htqldt-kien-truc-2023'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['BullMQ'],
    forbiddenClaims: ['RabbitMQ là công nghệ hiện tại'],
  }),
];

// ===========================================================================
// numerical.jsonl — numerical_exact + temporal
// ===========================================================================
const numerical = [
  C({
    id: 'num-redis-port-2023',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Ở phiên bản 1.0, Redis chạy trên cổng nào?',
    answer: 'Cổng 6379.',
    docs: ['htqldt-kien-truc-2023'],
    distract: ['htqldt-kien-truc-2025'],
    requiredFacts: ['6379'],
    forbiddenClaims: ['6380'],
  }),
  C({
    id: 'num-redis-port-current',
    type: 'EXACT_IDENTIFIER',
    category: 'temporal',
    question: 'Phiên bản hiện tại của hệ thống dùng Redis ở cổng nào?',
    answer: 'Cổng 6380 (từ phiên bản 2.0 ban hành 03/2025; trước đó là 6379).',
    docs: ['htqldt-kien-truc-2025'],
    distract: ['htqldt-kien-truc-2023'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['6380'],
    forbiddenClaims: ['6379 là cổng hiện tại'],
  }),
  C({
    id: 'num-db-current',
    type: 'EXACT_IDENTIFIER',
    category: 'temporal',
    question: 'Sau khi đổi kiến trúc, cơ sở dữ liệu chính là gì và phiên bản nào?',
    answer: 'PostgreSQL 16 kèm pgvector, áp dụng từ phiên bản 2.0 (03/2025); trước đó là MySQL 8.0.',
    docs: ['htqldt-kien-truc-2025'],
    distract: ['htqldt-kien-truc-2023'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['PostgreSQL 16'],
    forbiddenClaims: ['MySQL là cơ sở dữ liệu hiện tại'],
  }),
  C({
    id: 'num-db-2023',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Phiên bản 1.0 (01/2023) dùng cơ sở dữ liệu gì?',
    answer: 'MySQL 8.0.',
    docs: ['htqldt-kien-truc-2023'],
    distract: ['htqldt-kien-truc-2025'],
    requiredFacts: ['MySQL 8.0'],
  }),
  C({
    id: 'num-upload-limit',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Mỗi tài liệu tải lên tối đa bao nhiêu MB?',
    answer: '20 MB.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['20 MB'],
  }),
  C({
    id: 'num-llm-timeout',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Thời gian chờ mỗi lời gọi mô hình ngôn ngữ là bao nhiêu giây?',
    answer: '30 giây.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['30 giây'],
  }),
  C({
    id: 'num-vector-dim',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Số chiều vector embedding của hệ thống là bao nhiêu?',
    answer: '1024.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['1024'],
  }),
  C({
    id: 'num-topk',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Top-K mặc định khi truy hồi là bao nhiêu, và sau rerank còn lại mấy?',
    answer: 'Top-K mặc định là 20; sau rerank giữ lại 5.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['20', '5'],
  }),
  C({
    id: 'num-ram',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'RAM tối thiểu cho máy chủ ứng dụng là bao nhiêu?',
    answer: '16 GB.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['16 GB'],
  }),
  C({
    id: 'num-p95',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Mục tiêu độ trễ p95 của truy vấn là bao nhiêu mili giây?',
    answer: '2000 mili giây.',
    docs: ['htqldt-van-hanh'],
    requiredFacts: ['2000'],
  }),
  C({
    id: 'num-thuctap-cntt-tuan',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Sinh viên Khoa Công nghệ Thông tin thực tập tốt nghiệp bao nhiêu tuần?',
    answer: 'Mười tuần liên tục, tương đương 5 tín chỉ.',
    docs: ['quy-dinh-thuc-tap-cntt'],
    distract: ['quy-dinh-thuc-tap-cntp'],
    requiredFacts: ['mười tuần'],
    forbiddenClaims: ['tám tuần'],
  }),
  C({
    id: 'num-phienban-2-thang',
    type: 'EXACT_IDENTIFIER',
    category: 'temporal',
    question: 'Kiến trúc phiên bản 2.0 được ban hành vào tháng nào?',
    answer: 'Tháng 03/2025, thay thế phiên bản 1.0 ban hành tháng 01/2023.',
    docs: ['htqldt-kien-truc-2025'],
    also: ['htqldt-kien-truc-2023'],
    requiredFacts: ['03/2025'],
  }),
  C({
    id: 'num-queue-truoc',
    type: 'MULTI_HOP',
    category: 'temporal',
    question: 'Công nghệ hàng đợi nào được dùng trước, RabbitMQ hay BullMQ?',
    answer: 'RabbitMQ được dùng trước (phiên bản 1.0, 01/2023); BullMQ chỉ được dùng từ phiên bản 2.0 (03/2025).',
    docs: ['htqldt-kien-truc-2023', 'htqldt-kien-truc-2025'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['RabbitMQ được dùng trước'],
  }),
  C({
    id: 'num-hocphi-hoantra-tuan2',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'Rút học phần trong hai tuần đầu học kỳ được hoàn bao nhiêu phần trăm học phí?',
    answer: '100% học phí phần đã rút.',
    docs: ['quy-dinh-hoc-phi'],
    requiredFacts: ['100%'],
  }),
  C({
    id: 'num-ielts-mien',
    type: 'EXACT_IDENTIFIER',
    category: 'numerical_exact',
    question: 'IELTS bao nhiêu khi nhập học thì được miễn học phần tiếng Anh tăng cường?',
    answer: 'IELTS từ 6,0 trở lên.',
    docs: ['quy-dinh-chuan-tieng-anh'],
    requiredFacts: ['6,0'],
  }),
];

// ===========================================================================
// cross-document.jsonl — cần ghép >= 3 tài liệu
// ===========================================================================
const crossDoc = [
  C({
    id: 'xdoc-truongkhoa-duyet-khoakhac',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Trưởng khoa Công nghệ Thông tin có tự mình phê duyệt xong đề xuất đề tài của một sinh viên khoa mình không?',
    answer: 'Không. Trưởng khoa chỉ thao tác trên dữ liệu sinh viên khoa mình (đúng phạm vi), nhưng đề xuất đề tài phải qua ba cấp: Khoa, rồi Phòng Đào tạo, rồi Hội đồng Khoa học và Đào tạo — Khoa chỉ là cấp đầu.',
    docs: ['htqldt-pham-vi-khoa', 'quy-trinh-duyet-de-tai', 'htqldt-xac-thuc'],
    distract: ['quy-trinh-duyet-kinh-phi'],
    difficulty: 'expert',
    reasoningSteps: 3,
    requiredFacts: ['ba cấp', 'Phòng Đào tạo', 'Hội đồng Khoa học'],
    forbiddenClaims: ['trưởng khoa tự phê duyệt', 'chỉ cần Khoa duyệt'],
  }),
  C({
    id: 'xdoc-rbac-pham-vi-khoakhac',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Vai trò trưởng khoa trong hệ thống có xem được điểm sinh viên của khoa khác không?',
    answer: 'Không. RBAC có vai trò trưởng khoa, nhưng phạm vi dữ liệu của trưởng khoa bị giới hạn ở sinh viên thuộc khoa mình quản lý.',
    docs: ['htqldt-xac-thuc', 'htqldt-pham-vi-khoa'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['không', 'khoa mình quản lý'],
  }),
  C({
    id: 'xdoc-hocbong-renluyen-kyluat',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Một sinh viên GPA học kỳ 3,5 nhưng bị khiển trách trong học kỳ đó có được xét học bổng không?',
    answer: 'Không. Học bổng yêu cầu không bị kỷ luật từ mức khiển trách và điểm rèn luyện từ 80; sinh viên bị khiển trách có điểm rèn luyện không vượt loại trung bình (dưới 65), nên trượt cả hai điều kiện.',
    docs: ['quy-che-hoc-bong', 'quy-dinh-ren-luyen'],
    difficulty: 'hard',
    reasoningSteps: 3,
    requiredFacts: ['không', 'khiển trách', 'rèn luyện'],
    forbiddenClaims: ['vẫn được xét học bổng'],
  }),
  C({
    id: 'xdoc-thuctap-cntt-vs-cntp-dieukien',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'So với Khoa Công nghệ Thực phẩm, Khoa Công nghệ Thông tin yêu cầu tích luỹ nhiều hơn bao nhiêu tín chỉ để đăng ký thực tập?',
    answer: 'Nhiều hơn 5 tín chỉ: Khoa Công nghệ Thông tin yêu cầu 100 tín chỉ, Khoa Công nghệ Thực phẩm yêu cầu 95 tín chỉ.',
    docs: ['quy-dinh-thuc-tap-cntt', 'quy-dinh-thuc-tap-cntp'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['100', '95', '5 tín chỉ'],
  }),
  C({
    id: 'xdoc-de-tai-vs-kinh-phi-cap-cuoi',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Cấp phê duyệt cuối cùng của đề xuất đề tài nghiên cứu và của đề xuất kinh phí hoạt động có giống nhau không?',
    answer: 'Không. Đề tài nghiên cứu do Hội đồng Khoa học và Đào tạo phê duyệt cuối cùng; đề xuất kinh phí do Ban Giám hiệu phê duyệt, Khoa chỉ nhận thông báo.',
    docs: ['quy-trinh-duyet-de-tai', 'quy-trinh-duyet-kinh-phi'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['Hội đồng Khoa học', 'Ban Giám hiệu'],
  }),
  C({
    id: 'xdoc-phong-nao-lam-gi',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Việc xét học bổng và việc xét điều kiện dự thi do cùng một phòng phụ trách phải không?',
    answer: 'Không. Xét học bổng do Phòng Công tác Sinh viên; xét điều kiện dự thi và tổ chức xét tốt nghiệp do Phòng Đào tạo.',
    docs: ['chuc-nang-phong-dao-tao', 'chuc-nang-phong-ctsv'],
    difficulty: 'medium',
    reasoningSteps: 2,
    requiredFacts: ['Phòng Công tác Sinh viên', 'Phòng Đào tạo'],
  }),
  C({
    id: 'xdoc-sso-rbac-pham-vi',
    type: 'MULTI_HOP',
    category: 'cross_document',
    question: 'Hệ thống xác thực bằng cách nào và trưởng khoa bị giới hạn phạm vi dữ liệu ra sao?',
    answer: 'Xác thực bằng tài khoản nội bộ + mật khẩu, có SSO qua OIDC; phân quyền theo RBAC với bốn vai trò, trong đó trưởng khoa chỉ thao tác được trên dữ liệu sinh viên khoa mình quản lý.',
    docs: ['htqldt-xac-thuc', 'htqldt-pham-vi-khoa'],
    difficulty: 'medium',
    reasoningSteps: 2,
    requiredFacts: ['RBAC', 'bốn vai trò', 'OIDC'],
  }),
];

// ===========================================================================
// entity-disambiguation.jsonl
// ===========================================================================
const entity = [
  C({
    id: 'ent-thuctap-cntp-tuan',
    type: 'EXACT_IDENTIFIER',
    category: 'entity_disambiguation',
    question: 'Thực tập tốt nghiệp của Khoa Công nghệ Thực phẩm kéo dài mấy tuần?',
    answer: 'Tám tuần liên tục tại nhà máy chế biến, tương đương 4 tín chỉ.',
    docs: ['quy-dinh-thuc-tap-cntp'],
    distract: ['quy-dinh-thuc-tap-cntt'],
    requiredFacts: ['tám tuần'],
    forbiddenClaims: ['mười tuần'],
  }),
  C({
    id: 'ent-thuctap-cntt-tinchi',
    type: 'EXACT_IDENTIFIER',
    category: 'entity_disambiguation',
    question: 'Thực tập của Khoa CNTT tương đương bao nhiêu tín chỉ?',
    answer: '5 tín chỉ (mười tuần).',
    docs: ['quy-dinh-thuc-tap-cntt'],
    distract: ['quy-dinh-thuc-tap-cntp'],
    requiredFacts: ['5 tín chỉ'],
    forbiddenClaims: ['4 tín chỉ'],
  }),
  C({
    id: 'ent-phong-ctsv-phuckhao',
    type: 'ADVERSARIAL',
    category: 'entity_disambiguation',
    question: 'Phòng Công tác Sinh viên tiếp nhận đơn phúc khảo bài thi đúng không?',
    answer: null,
    negativeType: 'false_premise',
    docs: [],
    corpusExtra: ['chuc-nang-phong-ctsv', 'chuc-nang-phong-dao-tao'],
    forbiddenClaims: ['Phòng Công tác Sinh viên tiếp nhận đơn phúc khảo', 'đúng'],
  }),
  C({
    id: 'ent-hoi-dong-tuyensinh-detai',
    type: 'ADVERSARIAL',
    category: 'entity_disambiguation',
    question: 'Hội đồng Tuyển sinh phê duyệt đề tài nghiên cứu của sinh viên ở cấp nào?',
    answer: null,
    negativeType: 'attribute_missing',
    docs: [],
    corpusExtra: ['hoi-dong-tuyen-sinh', 'hoi-dong-khoa-hoc'],
    forbiddenClaims: ['Hội đồng Tuyển sinh phê duyệt đề tài'],
  }),
  C({
    id: 'ent-hoi-dong-khoahoc-vaitro',
    type: 'DIRECT_RETRIEVAL',
    category: 'entity_disambiguation',
    question: 'Hội đồng Khoa học và Đào tạo có vai trò gì với đề xuất đề tài của sinh viên?',
    answer: 'Phê duyệt đề xuất đề tài nghiên cứu của sinh viên ở cấp cuối cùng.',
    docs: ['hoi-dong-khoa-hoc'],
    distract: ['hoi-dong-tuyen-sinh'],
    requiredFacts: ['cấp cuối cùng'],
  }),
  C({
    id: 'ent-phong-daotao-vs-ctsv-renluyen',
    type: 'DIRECT_RETRIEVAL',
    category: 'entity_disambiguation',
    question: 'Phòng nào đánh giá kết quả rèn luyện của sinh viên?',
    answer: 'Phòng Công tác Sinh viên.',
    docs: ['chuc-nang-phong-ctsv'],
    distract: ['chuc-nang-phong-dao-tao'],
    requiredFacts: ['Phòng Công tác Sinh viên'],
    forbiddenClaims: ['Phòng Đào tạo đánh giá rèn luyện'],
  }),
  C({
    id: 'ent-cntt-cntp-antoan',
    type: 'SEMANTIC_QUERY',
    category: 'entity_disambiguation',
    question: 'Khoa nào yêu cầu khoá tập huấn an toàn vệ sinh thực phẩm trước khi đi thực tập?',
    answer: 'Khoa Công nghệ Thực phẩm.',
    docs: ['quy-dinh-thuc-tap-cntp'],
    distract: ['quy-dinh-thuc-tap-cntt'],
    requiredFacts: ['Khoa Công nghệ Thực phẩm'],
  }),
  C({
    id: 'ent-tuyensinh-chitieu',
    type: 'DIRECT_RETRIEVAL',
    category: 'entity_disambiguation',
    question: 'Hội đồng Tuyển sinh làm những việc gì?',
    answer: 'Xây dựng đề án tuyển sinh, xác định chỉ tiêu và điểm chuẩn, tổ chức xét và công bố kết quả trúng tuyển.',
    docs: ['hoi-dong-tuyen-sinh'],
    distract: ['hoi-dong-khoa-hoc'],
    requiredFacts: ['chỉ tiêu', 'điểm chuẩn'],
  }),
];

// ===========================================================================
// distractor.jsonl — tài liệu nhiễu gần giống + long_context
// ===========================================================================
const distractor = [
  C({
    id: 'dis-duyet-de-tai-trinh-tu',
    type: 'MULTI_HOP',
    category: 'distractor',
    question: 'Đề xuất đề tài nghiên cứu của sinh viên hiện nay đi qua những cấp nào, theo thứ tự?',
    answer: 'Theo trình tự: Khoa quản lý ngành duyệt trước, rồi Phòng Đào tạo, cuối cùng Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'],
    distract: ['quy-trinh-duyet-de-tai-cu', 'quy-trinh-duyet-kinh-phi'],
    difficulty: 'hard',
    reasoningSteps: 2,
    requiredFacts: ['Khoa', 'Phòng Đào tạo', 'Hội đồng Khoa học'],
    forbiddenClaims: ['Phòng Đào tạo duyệt trước', 'Phòng Kế hoạch', 'Ban Giám hiệu'],
  }),
  C({
    id: 'dis-duyet-de-tai-cap-dau',
    type: 'DIRECT_RETRIEVAL',
    category: 'distractor',
    question: 'Cấp đầu tiên xét đề xuất đề tài nghiên cứu của sinh viên là ai?',
    answer: 'Khoa quản lý ngành (theo quy trình hiện hành từ năm học 2024-2025).',
    docs: ['quy-trinh-duyet-de-tai'],
    distract: ['quy-trinh-duyet-de-tai-cu'],
    difficulty: 'hard',
    requiredFacts: ['Khoa'],
    forbiddenClaims: ['Phòng Đào tạo duyệt trước'],
  }),
  C({
    id: 'dis-kinh-phi-khong-phai-de-tai',
    type: 'ADVERSARIAL',
    category: 'distractor',
    question: 'Phòng Kế hoạch — Tài chính thẩm định đề xuất đề tài nghiên cứu ở bước nào?',
    answer: null,
    negativeType: 'similar_concept',
    docs: [],
    corpusExtra: ['quy-trinh-duyet-kinh-phi', 'quy-trinh-duyet-de-tai'],
    forbiddenClaims: ['Phòng Kế hoạch — Tài chính thẩm định đề tài'],
  }),
  C({
    id: 'dis-thi-trongso-distract',
    type: 'EXACT_IDENTIFIER',
    category: 'distractor',
    question: 'Điểm thi kết thúc học phần chiếm trọng số bao nhiêu?',
    answer: '60% (điểm đánh giá quá trình 40%), trừ khi đề cương học phần quy định khác.',
    docs: ['quy-che-thi'],
    distract: ['quy-che-hoc-bong'],
    requiredFacts: ['60%'],
  }),
  C({
    id: 'dis-hotline-long-context',
    type: 'EXACT_IDENTIFIER',
    category: 'long_context',
    question: 'Số điện thoại đường dây nóng hỗ trợ kỹ thuật cho sinh viên là số nào?',
    answer: '1900 1088 (trực trong giờ hành chính).',
    docs: ['so-tay-sinh-vien-2025'],
    difficulty: 'medium',
    requiredFacts: ['1900 1088'],
  }),
  C({
    id: 'dis-thuvien-muon-long-context',
    type: 'EXACT_IDENTIFIER',
    category: 'long_context',
    question: 'Sinh viên mượn tối đa mấy đầu sách một lần và trong bao nhiêu ngày?',
    answer: 'Tối đa năm đầu sách, thời hạn mười bốn ngày, gia hạn tối đa hai lần nếu sách không có người đặt trước.',
    docs: ['so-tay-sinh-vien-2025'],
    requiredFacts: ['năm đầu sách', 'mười bốn ngày'],
  }),
  C({
    id: 'dis-lich-hocky-long-context',
    type: 'DIRECT_RETRIEVAL',
    category: 'long_context',
    question: 'Học kỳ 1 và học kỳ 2 thường bắt đầu vào khoảng thời gian nào?',
    answer: 'Học kỳ 1 vào đầu tháng 9, học kỳ 2 vào đầu tháng 2; lịch cụ thể do Phòng Đào tạo công bố.',
    docs: ['so-tay-sinh-vien-2025'],
    requiredFacts: ['tháng 9', 'tháng 2'],
  }),
  C({
    id: 'dis-yte-long-context',
    type: 'SEMANTIC_QUERY',
    category: 'long_context',
    question: 'Phòng y tế của trường cấp giấy nghỉ ốm tối đa mấy ngày?',
    answer: 'Không quá ba ngày; cần nghỉ dài hơn thì nộp giấy của cơ sở y tế tuyến trên cho Phòng Đào tạo.',
    docs: ['so-tay-sinh-vien-2025'],
    requiredFacts: ['ba ngày'],
  }),
  C({
    id: 'dis-roi-truong-long-context',
    type: 'SEMANTIC_QUERY',
    category: 'long_context',
    question: 'Trước khi nhận bằng tốt nghiệp sinh viên phải hoàn tất thủ tục gì?',
    answer: 'Thanh toán với thư viện và ký túc xá.',
    docs: ['so-tay-sinh-vien-2025'],
    requiredFacts: ['thư viện', 'ký túc xá'],
  }),
  C({
    id: 'dis-wifi-long-context-negative',
    type: 'UNANSWERABLE',
    category: 'long_context',
    question: 'Mật khẩu wifi khu giảng đường ghi trong sổ tay sinh viên là gì?',
    answer: null,
    negativeType: 'attribute_missing',
    docs: [],
    corpusExtra: ['so-tay-sinh-vien-2025'],
    forbiddenClaims: ['mật khẩu wifi là'],
  }),
];

// ===========================================================================
// vietnamese-robustness.jsonl
// ===========================================================================
const viRobust = [
  C({
    id: 'vi-typo-phuckhao',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'phê khao bài thi nộp đơn trong may ngày?',
    answer: 'Trong vòng bảy ngày kể từ ngày công bố điểm.',
    docs: ['quy-che-thi'],
    metadata: { robustness: 'typo' },
    requiredFacts: ['bảy ngày'],
  }),
  C({
    id: 'vi-noaccent-baoluu',
    type: 'DIRECT_RETRIEVAL',
    category: 'vietnamese_robustness',
    question: 'sinh vien duoc bao luu toi da may hoc ky?',
    answer: 'Tối đa hai học kỳ liên tiếp.',
    docs: ['quy-che-bao-luu'],
    metadata: { robustness: 'no_accent' },
    requiredFacts: ['hai học kỳ'],
  }),
  C({
    id: 'vi-noaccent-hocphi',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'han dong hoc phi la bao lau ke tu dau hoc ky?',
    answer: 'Trong vòng bốn tuần kể từ ngày bắt đầu học kỳ.',
    docs: ['quy-dinh-hoc-phi'],
    metadata: { robustness: 'no_accent' },
    requiredFacts: ['bốn tuần'],
  }),
  C({
    id: 'vi-mixed-locking',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'optimistic locking dùng để xử lý race condition khi update một record thế nào?',
    answer: 'So cột version khi lưu; nếu version không khớp thì thao tác bị từ chối, người dùng phải tải lại rồi nhập lại.',
    docs: ['htqldt-dong-bo'],
    metadata: { robustness: 'mixed_vi_en' },
    language: 'mixed',
    requiredFacts: ['version', 'từ chối'],
  }),
  C({
    id: 'vi-mixed-sso',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'Hệ thống có support single sign-on không, dùng protocol gì?',
    answer: 'Có, SSO qua giao thức OIDC.',
    docs: ['htqldt-xac-thuc'],
    metadata: { robustness: 'mixed_vi_en' },
    language: 'mixed',
    requiredFacts: ['OIDC'],
  }),
  C({
    id: 'vi-short-query-rerank',
    type: 'EXACT_IDENTIFIER',
    category: 'vietnamese_robustness',
    question: 'top-k sau rerank?',
    answer: '5.',
    docs: ['htqldt-van-hanh'],
    metadata: { robustness: 'short_query' },
    requiredFacts: ['5'],
  }),
  C({
    id: 'vi-short-query-redis',
    type: 'EXACT_IDENTIFIER',
    category: 'vietnamese_robustness',
    question: 'redis port hiện tại?',
    answer: '6380.',
    docs: ['htqldt-kien-truc-2025'],
    distract: ['htqldt-kien-truc-2023'],
    metadata: { robustness: 'short_query' },
    requiredFacts: ['6380'],
  }),
  C({
    id: 'vi-conversational-detai',
    type: 'MULTI_HOP',
    category: 'vietnamese_robustness',
    question: 'Cái đề xuất đề tài này phải qua mấy cửa mới xong vậy?',
    answer: 'Ba cấp: Khoa, rồi Phòng Đào tạo, rồi Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'],
    distract: ['quy-trinh-duyet-de-tai-cu'],
    metadata: { robustness: 'conversational' },
    reasoningSteps: 2,
    requiredFacts: ['ba cấp'],
  }),
  C({
    id: 'vi-conversational-hocbong',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'Muốn xin học bổng thì phải được nhiêu điểm với hạnh kiểm sao ạ?',
    answer: 'Điểm trung bình học kỳ từ 3,2 và điểm rèn luyện từ 80 trở lên, không có học phần dưới C.',
    docs: ['quy-che-hoc-bong'],
    metadata: { robustness: 'conversational' },
    requiredFacts: ['3,2', '80'],
  }),
  C({
    id: 'vi-synonym-duyet',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'Ai là người ký duyệt sau cùng cho đề tài nghiên cứu của sinh viên?',
    answer: 'Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'],
    metadata: { robustness: 'synonym' },
    requiredFacts: ['Hội đồng Khoa học'],
  }),
  C({
    id: 'vi-synonym-phongdaotao',
    type: 'SEMANTIC_QUERY',
    category: 'vietnamese_robustness',
    question: 'Nộp đơn xin nghỉ học tạm thời cho phòng đào tạo hay phòng CTSV?',
    answer: 'Phòng Đào tạo (bộ phận tiếp nhận đơn bảo lưu, phúc khảo, chuyển ngành).',
    docs: ['chuc-nang-phong-dao-tao'],
    distract: ['chuc-nang-phong-ctsv'],
    metadata: { robustness: 'synonym' },
    requiredFacts: ['Phòng Đào tạo'],
  }),
  C({
    id: 'vi-typo-thuctap',
    type: 'EXACT_IDENTIFIER',
    category: 'vietnamese_robustness',
    question: 'sv khoa cntt thuc tap bao nhieu tuan?',
    answer: 'Mười tuần.',
    docs: ['quy-dinh-thuc-tap-cntt'],
    distract: ['quy-dinh-thuc-tap-cntp'],
    metadata: { robustness: 'typo' },
    requiredFacts: ['mười tuần'],
  }),
];

// ===========================================================================
// agent-routing.jsonl — RAG vs tool vs rag_and_tool (PROMPT §18)
// RAG-only PHẢI abstain trên case tool/rag_and_tool → answerable=false.
// ===========================================================================
const agentRouting = [
  C({
    id: 'agt-rag-quytrinh',
    type: 'DIRECT_RETRIEVAL',
    category: 'agent_routing',
    question: 'Quy trình phê duyệt đề xuất đề tài của hệ thống gồm những cấp nào?',
    answer: 'Khoa, rồi Phòng Đào tạo, rồi Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'],
    expectedAction: 'rag',
    requiredFacts: ['ba cấp'],
  }),
  C({
    id: 'agt-rag-hocbong-dieukien',
    type: 'DIRECT_RETRIEVAL',
    category: 'agent_routing',
    question: 'Điều kiện điểm để được xét học bổng khuyến khích học tập là gì?',
    answer: 'Điểm trung bình học kỳ từ 3,2 và điểm rèn luyện từ 80 trở lên.',
    docs: ['quy-che-hoc-bong'],
    expectedAction: 'rag',
    requiredFacts: ['3,2', '80'],
  }),
  C({
    id: 'agt-tool-trangthai-de-xuat',
    type: 'UNANSWERABLE',
    category: 'agent_routing',
    question: 'Đề xuất đề tài số 123 của tôi hiện đang ở bước phê duyệt nào?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-trinh-duyet-de-tai'],
    expectedAction: 'tool',
    metadata: { toolHint: 'proposal_status(proposal_id)' },
    forbiddenClaims: ['đề xuất số 123 đang ở bước'],
  }),
  C({
    id: 'agt-tool-diem-sinhvien',
    type: 'UNANSWERABLE',
    category: 'agent_routing',
    question: 'Sinh viên mã số 20207890 đã tích luỹ bao nhiêu tín chỉ?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-dinh-thuc-tap-cntt'],
    expectedAction: 'tool',
    metadata: { toolHint: 'student_detail(student_id)' },
    forbiddenClaims: ['sinh viên 20207890 đã tích luỹ'],
  }),
  C({
    id: 'agt-tool-hocphi-conno',
    type: 'UNANSWERABLE',
    category: 'agent_routing',
    question: 'Hiện tôi còn nợ học phí học kỳ này bao nhiêu tiền?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-dinh-hoc-phi'],
    expectedAction: 'tool',
    metadata: { toolHint: 'tuition_balance(student_id)' },
  }),
  C({
    id: 'agt-ragtool-de-xuat-buoc-vs-quydinh',
    type: 'MULTI_HOP',
    category: 'agent_routing',
    question: 'Đề xuất số 123 đang ở bước nào và theo quy định thì bước đó do ai duyệt?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-trinh-duyet-de-tai'],
    expectedAction: 'rag_and_tool',
    difficulty: 'hard',
    reasoningSteps: 2,
    metadata: {
      toolHint: 'proposal_status(123)',
      ruleDocuments: ['quy-trinh-duyet-de-tai'],
    },
  }),
  C({
    id: 'agt-ragtool-sv-du-dieukien-thuctap',
    type: 'MULTI_HOP',
    category: 'agent_routing',
    question: 'Sinh viên 20207890 (Khoa CNTT) đã đủ điều kiện tín chỉ để đăng ký thực tập tốt nghiệp chưa?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-dinh-thuc-tap-cntt'],
    expectedAction: 'rag_and_tool',
    difficulty: 'hard',
    reasoningSteps: 2,
    metadata: {
      toolHint: 'student_detail(20207890)',
      ruleDocuments: ['quy-dinh-thuc-tap-cntt'],
    },
  }),
  C({
    id: 'agt-ragtool-hocbong-xet',
    type: 'MULTI_HOP',
    category: 'agent_routing',
    question: 'Với GPA học kỳ và điểm rèn luyện hiện tại của tôi thì tôi có đủ điều kiện xét học bổng không?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-che-hoc-bong'],
    expectedAction: 'rag_and_tool',
    difficulty: 'hard',
    reasoningSteps: 2,
    metadata: {
      toolHint: 'student_gpa(student_id)',
      ruleDocuments: ['quy-che-hoc-bong'],
    },
  }),
  C({
    id: 'agt-rag-thoihan-phuckhao',
    type: 'DIRECT_RETRIEVAL',
    category: 'agent_routing',
    question: 'Thời hạn nộp đơn phúc khảo là bao lâu?',
    answer: 'Trong vòng bảy ngày kể từ ngày công bố điểm.',
    docs: ['quy-che-thi'],
    expectedAction: 'rag',
    requiredFacts: ['bảy ngày'],
  }),
  C({
    id: 'agt-tool-lich-thi',
    type: 'UNANSWERABLE',
    category: 'agent_routing',
    question: 'Lịch thi cuối kỳ môn Cơ sở dữ liệu của lớp tôi là ngày mấy?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-che-thi'],
    expectedAction: 'tool',
    metadata: { toolHint: 'exam_schedule(class_id, course_id)' },
  }),
  C({
    id: 'agt-rag-chuan-tienganh',
    type: 'DIRECT_RETRIEVAL',
    category: 'agent_routing',
    question: 'Chuẩn đầu ra tiếng Anh để tốt nghiệp là gì?',
    answer: 'Tiếng Anh bậc 3/6 theo Khung năng lực ngoại ngữ Việt Nam hoặc chứng chỉ tương đương.',
    docs: ['quy-dinh-chuan-tieng-anh'],
    expectedAction: 'rag',
    requiredFacts: ['bậc 3'],
  }),
  C({
    id: 'agt-tool-dangky-monhoc',
    type: 'UNANSWERABLE',
    category: 'agent_routing',
    question: 'Học kỳ này lớp học phần Trí tuệ nhân tạo còn chỗ trống không?',
    answer: null,
    negativeType: 'completely_unknown',
    docs: [],
    corpusExtra: ['quy-che-thi'],
    expectedAction: 'tool',
    metadata: { toolHint: 'class_capacity(course_id)' },
  }),
];

// ===========================================================================
// golden.jsonl — regression suite (id riêng, corpus tự chứa)
// ===========================================================================
const golden = [
  C({ id: 'gold-baoluu', type: 'DIRECT_RETRIEVAL', category: 'direct_retrieval', difficulty: 'easy',
    question: 'Sinh viên được bảo lưu kết quả học tập tối đa mấy học kỳ?',
    answer: 'Tối đa hai học kỳ liên tiếp trong toàn khoá học.',
    docs: ['quy-che-bao-luu'], corpusExtra: NOISE_UNI, requiredFacts: ['hai học kỳ liên tiếp'] }),
  C({ id: 'gold-hocphi-hoantra', type: 'EXACT_IDENTIFIER', category: 'numerical_exact',
    question: 'Rút học phần ở tuần thứ tư được hoàn trả bao nhiêu phần trăm học phí?',
    answer: 'Được hoàn trả 50%.', docs: ['quy-dinh-hoc-phi'], requiredFacts: ['50%'], forbiddenClaims: ['100%'] }),
  C({ id: 'gold-redis-port-now', type: 'EXACT_IDENTIFIER', category: 'temporal', difficulty: 'hard', reasoningSteps: 2,
    question: 'Phiên bản hiện tại của hệ thống dùng Redis ở cổng nào?',
    answer: 'Cổng 6380 (từ phiên bản 2.0, 03/2025).',
    docs: ['htqldt-kien-truc-2025'], distract: ['htqldt-kien-truc-2023'],
    requiredFacts: ['6380'], forbiddenClaims: ['6379 là cổng hiện tại'] }),
  C({ id: 'gold-db-now', type: 'EXACT_IDENTIFIER', category: 'temporal', difficulty: 'hard', reasoningSteps: 2,
    question: 'Sau khi đổi kiến trúc, cơ sở dữ liệu chính của hệ thống là gì?',
    answer: 'PostgreSQL 16 kèm pgvector (trước đó là MySQL 8.0).',
    docs: ['htqldt-kien-truc-2025'], distract: ['htqldt-kien-truc-2023'],
    requiredFacts: ['PostgreSQL 16'], forbiddenClaims: ['MySQL là cơ sở dữ liệu hiện tại'] }),
  C({ id: 'gold-locking', type: 'SEMANTIC_QUERY', category: 'keyword_mismatch', difficulty: 'hard',
    question: 'Hệ thống xử lý thế nào khi hai người cùng sửa một bản ghi?',
    answer: 'Dùng khoá lạc quan trên cột version; nếu version không khớp khi lưu thì bị từ chối, phải tải lại và nhập lại.',
    docs: ['htqldt-dong-bo'], corpusExtra: NOISE_SYS,
    requiredFacts: ['khoá lạc quan', 'version'] }),
  C({ id: 'gold-duyet-de-tai', type: 'MULTI_HOP', category: 'distractor', difficulty: 'hard', reasoningSteps: 2,
    question: 'Đề xuất đề tài nghiên cứu của sinh viên hiện nay đi qua những cấp nào theo thứ tự?',
    answer: 'Khoa quản lý ngành, rồi Phòng Đào tạo, rồi Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'], distract: ['quy-trinh-duyet-de-tai-cu', 'quy-trinh-duyet-kinh-phi'],
    requiredFacts: ['Khoa', 'Phòng Đào tạo', 'Hội đồng Khoa học'],
    forbiddenClaims: ['Phòng Đào tạo duyệt trước', 'Ban Giám hiệu'] }),
  C({ id: 'gold-xdoc-truongkhoa', type: 'MULTI_HOP', category: 'cross_document', difficulty: 'expert', reasoningSteps: 3,
    question: 'Trưởng khoa CNTT có tự phê duyệt xong đề xuất đề tài của sinh viên khoa mình không?',
    answer: 'Không — Khoa chỉ là cấp đầu, đề xuất còn phải qua Phòng Đào tạo và Hội đồng Khoa học và Đào tạo.',
    docs: ['htqldt-pham-vi-khoa', 'quy-trinh-duyet-de-tai', 'htqldt-xac-thuc'],
    distract: ['quy-trinh-duyet-kinh-phi'],
    requiredFacts: ['ba cấp', 'Phòng Đào tạo', 'Hội đồng Khoa học'],
    forbiddenClaims: ['trưởng khoa tự phê duyệt'] }),
  C({ id: 'gold-mh-hocbong-kyluat', type: 'MULTI_HOP', category: 'multi_hop', difficulty: 'hard', reasoningSteps: 3,
    question: 'Sinh viên GPA học kỳ 3,5 nhưng bị khiển trách có được xét học bổng không? Vì sao?',
    answer: 'Không. Học bổng yêu cầu không bị kỷ luật từ mức khiển trách; ngoài ra khiển trách khiến điểm rèn luyện không vượt loại trung bình, dưới ngưỡng 80.',
    docs: ['quy-che-hoc-bong', 'quy-dinh-ren-luyen'],
    requiredFacts: ['không', 'khiển trách', 'rèn luyện'],
    forbiddenClaims: ['vẫn được xét học bổng'] }),
  C({ id: 'gold-thuctap-cntt', type: 'EXACT_IDENTIFIER', category: 'entity_disambiguation',
    question: 'Sinh viên Khoa Công nghệ Thông tin thực tập tốt nghiệp bao nhiêu tuần?',
    answer: 'Mười tuần, tương đương 5 tín chỉ.',
    docs: ['quy-dinh-thuc-tap-cntt'], distract: ['quy-dinh-thuc-tap-cntp'],
    requiredFacts: ['mười tuần'], forbiddenClaims: ['tám tuần'] }),
  C({ id: 'gold-conflict-baoluu', type: 'CONFLICTING_SOURCES', category: 'conflicting', difficulty: 'hard', reasoningSteps: 2,
    question: 'Thời gian bảo lưu tối đa là bao nhiêu học kỳ theo các văn bản?',
    answer: 'Có mâu thuẫn: Quy chế bảo lưu nêu tối đa hai học kỳ, còn Thông báo sửa đổi 2024 rút xuống tối đa một học kỳ (áp dụng từ 2024-2025).',
    docs: ['quy-che-bao-luu', 'thong-bao-bao-luu-2024'],
    requiredFacts: ['hai học kỳ', 'một học kỳ', 'mâu thuẫn'],
    forbiddenClaims: ['ba học kỳ', 'không có mâu thuẫn'] }),
  C({ id: 'gold-un-ktx-gia', type: 'UNANSWERABLE', category: 'unanswerable',
    question: 'Giá thuê một chỗ ở ký túc xá mỗi tháng là bao nhiêu?',
    answer: null, negativeType: 'completely_unknown',
    docs: [], corpusExtra: ['quy-che-bao-luu', 'quy-dinh-hoc-phi'],
    forbiddenClaims: ['giá thuê ký túc xá là'] }),
  C({ id: 'gold-un-biometric', type: 'UNANSWERABLE', category: 'unanswerable',
    question: 'Hệ thống có hỗ trợ xác thực bằng sinh trắc học (vân tay, khuôn mặt) không?',
    answer: null, negativeType: 'attribute_missing',
    docs: [], corpusExtra: ['htqldt-xac-thuc'],
    forbiddenClaims: ['hỗ trợ sinh trắc học', 'không hỗ trợ sinh trắc học'] }),
  C({ id: 'gold-adv-mongodb', type: 'ADVERSARIAL', category: 'false_premise',
    question: 'Vì hệ thống dùng MongoDB làm cơ sở dữ liệu chính, cần cấu hình sharding thế nào?',
    answer: null, negativeType: 'false_premise',
    docs: [], corpusExtra: ['htqldt-kien-truc-2025', 'htqldt-kien-truc-2023'],
    forbiddenClaims: ['hệ thống dùng MongoDB', 'cấu hình sharding'] }),
  C({ id: 'gold-adv-baoluu-3ky', type: 'ADVERSARIAL', category: 'false_premise',
    question: 'Vì sinh viên được bảo lưu tối đa ba học kỳ, thủ tục xin gia hạn học kỳ thứ ba như thế nào?',
    answer: null, negativeType: 'false_premise',
    docs: [], corpusExtra: ['quy-che-bao-luu'],
    forbiddenClaims: ['bảo lưu tối đa ba học kỳ', 'thủ tục gia hạn học kỳ thứ ba'] }),
  C({ id: 'gold-num-topk', type: 'EXACT_IDENTIFIER', category: 'numerical_exact',
    question: 'Top-K mặc định khi truy hồi và số giữ lại sau rerank là bao nhiêu?',
    answer: 'Top-K mặc định 20; sau rerank giữ 5.',
    docs: ['htqldt-van-hanh'], requiredFacts: ['20', '5'] }),
  C({ id: 'gold-num-vectordim', type: 'EXACT_IDENTIFIER', category: 'numerical_exact', difficulty: 'easy',
    question: 'Số chiều vector embedding là bao nhiêu?',
    answer: '1024.', docs: ['htqldt-van-hanh'], requiredFacts: ['1024'] }),
  C({ id: 'gold-sem-baoluu', type: 'SEMANTIC_QUERY', category: 'semantic_paraphrase',
    question: 'Sinh viên có được tạm dừng việc học rồi quay lại không, tối đa bao lâu?',
    answer: 'Có, bảo lưu tối đa hai học kỳ liên tiếp.',
    docs: ['quy-che-bao-luu'], requiredFacts: ['hai học kỳ'] }),
  C({ id: 'gold-long-hotline', type: 'EXACT_IDENTIFIER', category: 'long_context',
    question: 'Số điện thoại đường dây nóng hỗ trợ kỹ thuật cho sinh viên là gì?',
    answer: '1900 1088.', docs: ['so-tay-sinh-vien-2025'], requiredFacts: ['1900 1088'] }),
  C({ id: 'gold-vi-noaccent', type: 'DIRECT_RETRIEVAL', category: 'vietnamese_robustness',
    question: 'sinh vien duoc bao luu toi da may hoc ky?',
    answer: 'Tối đa hai học kỳ liên tiếp.',
    docs: ['quy-che-bao-luu'], metadata: { robustness: 'no_accent' }, requiredFacts: ['hai học kỳ'] }),
  C({ id: 'gold-agt-tool', type: 'UNANSWERABLE', category: 'agent_routing',
    question: 'Đề xuất đề tài số 123 của tôi hiện đang ở bước nào?',
    answer: null, negativeType: 'completely_unknown',
    docs: [], corpusExtra: ['quy-trinh-duyet-de-tai'],
    expectedAction: 'tool', metadata: { toolHint: 'proposal_status(123)' },
    forbiddenClaims: ['đề xuất số 123 đang ở bước'] }),
  C({ id: 'gold-agt-rag', type: 'DIRECT_RETRIEVAL', category: 'agent_routing',
    question: 'Quy trình phê duyệt đề xuất đề tài gồm những cấp nào?',
    answer: 'Khoa, rồi Phòng Đào tạo, rồi Hội đồng Khoa học và Đào tạo.',
    docs: ['quy-trinh-duyet-de-tai'], expectedAction: 'rag', requiredFacts: ['ba cấp'] }),
  C({ id: 'gold-ent-phong', type: 'DIRECT_RETRIEVAL', category: 'entity_disambiguation',
    question: 'Phòng nào đánh giá kết quả rèn luyện của sinh viên?',
    answer: 'Phòng Công tác Sinh viên.',
    docs: ['chuc-nang-phong-ctsv'], distract: ['chuc-nang-phong-dao-tao'],
    requiredFacts: ['Phòng Công tác Sinh viên'],
    forbiddenClaims: ['Phòng Đào tạo đánh giá rèn luyện'] }),
  C({ id: 'gold-xdoc-phong', type: 'MULTI_HOP', category: 'cross_document', reasoningSteps: 2,
    question: 'Xét học bổng và xét điều kiện dự thi do cùng một phòng phụ trách không?',
    answer: 'Không. Học bổng do Phòng Công tác Sinh viên; điều kiện dự thi do Phòng Đào tạo.',
    docs: ['chuc-nang-phong-dao-tao', 'chuc-nang-phong-ctsv'],
    requiredFacts: ['Phòng Công tác Sinh viên', 'Phòng Đào tạo'] }),
];

// ===========================================================================
// GHI FILE
// ===========================================================================
const FILES = {
  semantic,
  numerical,
  'cross-document': crossDoc,
  'entity-disambiguation': entity,
  distractor,
  'vietnamese-robustness': viRobust,
  'agent-routing': agentRouting,
  golden,
};

mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const [name, cases] of Object.entries(FILES)) {
  const lines = cases.map((c) => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(resolve(OUT_DIR, `${name}.jsonl`), lines, 'utf8');
  console.log(`${name}.jsonl: ${cases.length} case`);
  total += cases.length;
}
console.log(
  `MỞ RỘNG: ${total} case, ${Object.keys(CORPUS).length} tài liệu corpus`,
);
