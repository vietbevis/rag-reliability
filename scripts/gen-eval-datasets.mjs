#!/usr/bin/env node
/**
 * Sinh golden dataset (evaluation/datasets/*.jsonl) từ một THƯ VIỆN CORPUS gọn
 * và danh sách case khai báo. Chạy: `node scripts/gen-eval-datasets.mjs`.
 *
 * Vì sao có script này (docs/audit/EVALUATION_REVIEW.md §4.1): giữ nguồn sự thật
 * ở một chỗ, dễ mở rộng lên hàng trăm case mà không copy-paste corpus. Mỗi case
 * .jsonl vẫn tự mang corpus (seed độc lập) — script resolve từ thư viện.
 *
 * Nội dung quy chế dưới đây là MÔ PHỎNG học thuật cho mục đích đánh giá RAG,
 * KHÔNG phải văn bản pháp quy thật của bất kỳ trường nào.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../evaluation/datasets');

// ---------------------------------------------------------------------------
// THƯ VIỆN CORPUS
// ---------------------------------------------------------------------------
const CORPUS = {
  'quy-che-bao-luu': {
    title: 'Quy chế bảo lưu kết quả học tập',
    text: `# Quy chế bảo lưu kết quả học tập

## Điều 1. Thời gian bảo lưu
Sinh viên được phép bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn khoá học. Việc bảo lưu vượt quá thời hạn này chỉ được xem xét trong trường hợp bất khả kháng có xác nhận của cơ quan có thẩm quyền.

## Điều 2. Thủ tục xin bảo lưu
Đơn xin bảo lưu phải nộp cho phòng đào tạo trước ngày bắt đầu học kỳ ít nhất mười lăm ngày làm việc. Đơn phải có xác nhận của cố vấn học tập và của khoa quản lý ngành.

## Điều 3. Quyền lợi trong thời gian bảo lưu
Trong thời gian bảo lưu, sinh viên không được đăng ký học phần, không được dự thi và không được hưởng các chế độ chính sách của trường dành cho sinh viên đang học.

## Điều 4. Trở lại học tập
Khi hết thời hạn bảo lưu, sinh viên phải làm thủ tục nhập học trở lại trong vòng ba mươi ngày. Quá hạn không có lý do chính đáng, sinh viên bị xoá tên khỏi danh sách.`,
  },
  'quy-dinh-hoc-phi': {
    title: 'Quy định về học phí và miễn giảm',
    text: `# Quy định về học phí và miễn giảm

## Điều 1. Mức học phí
Học phí được tính theo số tín chỉ sinh viên đăng ký trong mỗi học kỳ. Đơn giá một tín chỉ do hiệu trưởng quyết định và công bố trước khi bắt đầu năm học.

## Điều 2. Thời hạn đóng học phí
Sinh viên phải hoàn thành nghĩa vụ học phí trong vòng bốn tuần kể từ ngày bắt đầu học kỳ. Quá thời hạn này mà không có lý do chính đáng, sinh viên sẽ bị xoá tên khỏi danh sách lớp học phần.

## Điều 3. Miễn, giảm học phí
Sinh viên thuộc diện chính sách, hộ nghèo hoặc có hoàn cảnh đặc biệt khó khăn được xét miễn hoặc giảm học phí theo quy định hiện hành của Nhà nước. Hồ sơ xét miễn giảm nộp trong tháng đầu tiên của học kỳ.

## Điều 4. Hoàn trả học phí
Sinh viên rút học phần trong hai tuần đầu học kỳ được hoàn trả 100% học phí phần đã rút; từ tuần thứ ba đến tuần thứ sáu được hoàn trả 50%; sau tuần thứ sáu không được hoàn trả.`,
  },
  'quy-che-tot-nghiep': {
    title: 'Quy chế xét tốt nghiệp đại học',
    text: `# Quy chế xét tốt nghiệp đại học

## Điều 1. Điều kiện tốt nghiệp
Sinh viên được xét tốt nghiệp khi tích luỹ đủ số tín chỉ của chương trình đào tạo, có điểm trung bình tích luỹ từ 2,0 trở lên theo thang 4, không còn học phần bị điểm F và không trong thời gian bị kỷ luật từ mức đình chỉ học tập.

## Điều 2. Chuẩn đầu ra ngoại ngữ
Sinh viên phải đạt trình độ tiếng Anh bậc 3 theo Khung năng lực ngoại ngữ 6 bậc dùng cho Việt Nam, tương đương chứng chỉ được nhà trường công nhận, trước khi xét tốt nghiệp.

## Điều 3. Xếp loại tốt nghiệp
Xếp loại theo điểm trung bình tích luỹ: từ 3,6 đến 4,0 xuất sắc; từ 3,2 đến cận 3,6 giỏi; từ 2,5 đến cận 3,2 khá; từ 2,0 đến cận 2,5 trung bình.

## Điều 4. Hạ mức xếp loại
Hạ một mức xếp loại nếu sinh viên có khối lượng học phần phải học lại vượt quá 5% tổng số tín chỉ, hoặc bị kỷ luật từ mức khiển trách trở lên trong thời gian học.`,
  },
  'quy-che-thi': {
    title: 'Quy chế thi và đánh giá học phần',
    text: `# Quy chế thi và đánh giá học phần

## Điều 1. Điều kiện dự thi kết thúc học phần
Sinh viên không được dự thi kết thúc học phần nếu vắng mặt quá 20% số tiết của học phần đó, hoặc chưa hoàn thành nghĩa vụ học phí tại thời điểm thi.

## Điều 2. Điểm học phần
Điểm học phần gồm điểm đánh giá quá trình trọng số 40% và điểm thi kết thúc học phần trọng số 60%, trừ khi đề cương học phần quy định khác.

## Điều 3. Vắng thi
Sinh viên vắng thi không có lý do chính đáng nhận điểm 0 cho bài thi kết thúc học phần. Sinh viên vắng thi có lý do chính đáng được dự thi ở kỳ thi phụ do khoa tổ chức.

## Điều 4. Thi lại và học lại
Học phần bị điểm F phải học lại. Học phần đạt điểm D được đăng ký học cải thiện; điểm cao hơn trong hai lần học được dùng để tính điểm trung bình tích luỹ.`,
  },
  'quy-che-hoc-vu': {
    title: 'Quy chế học vụ và tiến độ học tập',
    text: `# Quy chế học vụ và tiến độ học tập

## Điều 1. Cảnh báo học vụ
Sinh viên bị cảnh báo học vụ nếu điểm trung bình học kỳ dưới 1,0 đối với học kỳ đầu, hoặc dưới 1,2 đối với các học kỳ tiếp theo, hoặc điểm trung bình tích luỹ dưới 1,2 sau hai học kỳ liên tiếp.

## Điều 2. Buộc thôi học
Sinh viên bị buộc thôi học nếu bị cảnh báo học vụ ba học kỳ liên tiếp, hoặc vượt quá thời gian tối đa hoàn thành chương trình.

## Điều 3. Thời gian tối đa hoàn thành chương trình
Thời gian tối đa để sinh viên hoàn thành chương trình đào tạo bằng thời gian thiết kế của chương trình cộng thêm hai năm. Thời gian bảo lưu không tính vào thời gian này.

## Điều 4. Đăng ký khối lượng học tập
Mỗi học kỳ chính, sinh viên đăng ký tối thiểu 14 tín chỉ, trừ học kỳ cuối khoá. Sinh viên đang bị cảnh báo học vụ chỉ được đăng ký tối đa 14 tín chỉ.`,
  },
  'quy-dinh-chuyen-nganh': {
    title: 'Quy định chuyển ngành, chuyển trường',
    text: `# Quy định chuyển ngành, chuyển trường

## Điều 1. Điều kiện chuyển ngành
Sinh viên được xét chuyển ngành sau khi học xong năm thứ nhất, có điểm trung bình tích luỹ từ 2,5 trở lên, không bị kỷ luật và ngành xin chuyển đến còn chỉ tiêu.

## Điều 2. Thời điểm nộp hồ sơ
Hồ sơ chuyển ngành nộp trong bốn tuần đầu của học kỳ 2 năm thứ nhất. Mỗi sinh viên chỉ được chuyển ngành một lần trong toàn khoá học.

## Điều 3. Bảo lưu kết quả khi chuyển ngành
Các học phần đã tích luỹ được bảo lưu nếu tương đương với học phần trong chương trình ngành mới, do khoa tiếp nhận xét công nhận.

## Điều 4. Chuyển trường
Sinh viên chuyển đến từ trường khác phải học tối thiểu hai năm cuối tại trường và tích luỹ tối thiểu 50% số tín chỉ của chương trình tại trường để được xét tốt nghiệp.`,
  },
  'quy-che-hoc-bong': {
    title: 'Quy chế học bổng khuyến khích học tập',
    text: `# Quy chế học bổng khuyến khích học tập

## Điều 1. Đối tượng
Học bổng khuyến khích học tập xét cho sinh viên hệ chính quy có kết quả học tập và rèn luyện tốt trong học kỳ, không bị kỷ luật từ mức khiển trách.

## Điều 2. Điều kiện học tập
Sinh viên được xét học bổng phải có điểm trung bình học kỳ từ 3,2 trở lên theo thang 4 và điểm rèn luyện từ 80 điểm trở lên, không có học phần dưới điểm C trong học kỳ xét.

## Điều 3. Mức học bổng
Mức học bổng loại khá bằng học phí một học kỳ; loại giỏi bằng 1,2 lần; loại xuất sắc bằng 1,5 lần. Tổng quỹ học bổng không vượt quá 8% nguồn thu học phí.

## Điều 4. Số lượng
Số suất học bổng mỗi ngành không vượt quá 10% số sinh viên của ngành trong học kỳ xét.`,
  },
  'quy-che-ky-luat': {
    title: 'Quy chế khen thưởng và kỷ luật sinh viên',
    text: `# Quy chế khen thưởng và kỷ luật sinh viên

## Điều 1. Các hình thức kỷ luật
Sinh viên vi phạm bị xử lý theo bốn mức: khiển trách, cảnh cáo, đình chỉ học tập có thời hạn và buộc thôi học.

## Điều 2. Gian lận thi cử
Sinh viên bị đình chỉ thi và nhận điểm 0 học phần khi mang tài liệu trái phép vào phòng thi. Trường hợp thi hộ hoặc nhờ thi hộ, cả hai bị đình chỉ học tập một năm.

## Điều 3. Hiệu lực kỷ luật
Quyết định kỷ luật khiển trách có hiệu lực trong một học kỳ; cảnh cáo trong một năm học. Trong thời gian thi hành kỷ luật, sinh viên không được xét học bổng và khen thưởng.

## Điều 4. Xoá kỷ luật
Sau khi hết thời hạn thi hành, nếu sinh viên tiến bộ và không tái phạm, quyết định kỷ luật được xoá và không ghi vào hồ sơ tốt nghiệp.`,
  },
  'quy-dinh-thuc-tap': {
    title: 'Quy định thực tập tốt nghiệp',
    text: `# Quy định thực tập tốt nghiệp

## Điều 1. Điều kiện đăng ký thực tập
Sinh viên được đăng ký thực tập tốt nghiệp khi đã tích luỹ tối thiểu 100 tín chỉ và không còn nợ học phần tiên quyết của học phần thực tập.

## Điều 2. Thời lượng
Thực tập tốt nghiệp kéo dài tối thiểu tám tuần liên tục tại đơn vị tiếp nhận, tương đương 4 tín chỉ.

## Điều 3. Đánh giá
Điểm thực tập gồm điểm của người hướng dẫn tại đơn vị trọng số 50% và điểm bảo vệ báo cáo trước hội đồng bộ môn trọng số 50%.

## Điều 4. Thực tập lại
Sinh viên bị điểm F học phần thực tập phải đăng ký thực tập lại ở học kỳ kế tiếp và không được xét làm đồ án tốt nghiệp cho đến khi đạt.`,
  },
  'quy-dinh-do-an': {
    title: 'Quy định đồ án, khoá luận tốt nghiệp',
    text: `# Quy định đồ án, khoá luận tốt nghiệp

## Điều 1. Điều kiện nhận đồ án
Sinh viên được giao đồ án tốt nghiệp khi đã tích luỹ tối thiểu 85% số tín chỉ của chương trình, điểm trung bình tích luỹ từ 2,5 trở lên và đã hoàn thành học phần thực tập tốt nghiệp.

## Điều 2. Thời gian thực hiện
Đồ án tốt nghiệp thực hiện trong một học kỳ, tương đương 10 tín chỉ. Sinh viên không hoàn thành đúng hạn được gia hạn tối đa một học kỳ, sau đó phải nhận đề tài mới.

## Điều 3. Điều kiện bảo vệ
Sinh viên được bảo vệ đồ án khi có nhận xét đồng ý cho bảo vệ của giảng viên hướng dẫn và của giảng viên phản biện.

## Điều 4. Thay thế đồ án
Sinh viên không đủ điều kiện làm đồ án được đăng ký học các học phần thay thế với tổng số tín chỉ tương đương do khoa quy định.`,
  },
  'quy-dinh-dang-ky-hoc-phan': {
    title: 'Quy định đăng ký học phần',
    text: `# Quy định đăng ký học phần

## Điều 1. Thời gian đăng ký
Đăng ký học phần thực hiện trực tuyến trong hai tuần trước khi học kỳ bắt đầu. Sinh viên được điều chỉnh đăng ký trong tuần đầu tiên của học kỳ.

## Điều 2. Điều kiện tiên quyết
Sinh viên chỉ được đăng ký học phần khi đã đạt các học phần tiên quyết và học phần học trước theo chương trình đào tạo.

## Điều 3. Rút học phần
Sinh viên được rút học phần đến hết tuần thứ sáu của học kỳ. Học phần đã rút ghi ký hiệu W trên bảng điểm và không tính vào điểm trung bình.

## Điều 4. Huỷ đăng ký do sĩ số
Lớp học phần có số sinh viên đăng ký dưới 20 có thể bị huỷ. Sinh viên của lớp bị huỷ được đăng ký bổ sung học phần khác mà không bị tính là điều chỉnh muộn.`,
  },
  'quy-dinh-ren-luyen': {
    title: 'Quy định đánh giá kết quả rèn luyện',
    text: `# Quy định đánh giá kết quả rèn luyện

## Điều 1. Thang điểm
Điểm rèn luyện được đánh giá theo thang 100, gồm năm nhóm tiêu chí về ý thức học tập, chấp hành nội quy, hoạt động xã hội, quan hệ cộng đồng và công tác lớp.

## Điều 2. Phân loại
Xuất sắc từ 90 điểm; tốt từ 80 đến dưới 90; khá từ 65 đến dưới 80; trung bình từ 50 đến dưới 65; yếu dưới 50.

## Điều 3. Ảnh hưởng của kỷ luật
Sinh viên bị kỷ luật mức khiển trách trong học kỳ thì điểm rèn luyện không vượt quá loại trung bình; mức cảnh cáo trở lên xếp loại yếu.

## Điều 4. Sử dụng kết quả
Kết quả rèn luyện là một tiêu chí xét học bổng, xét khen thưởng và được lưu trong hồ sơ sinh viên cùng kết quả học tập.`,
  },
  'quy-dinh-nghi-hoc-tam-thoi': {
    title: 'Quy định nghỉ học tạm thời và thôi học',
    text: `# Quy định nghỉ học tạm thời và thôi học

## Điều 1. Nghỉ học tạm thời
Sinh viên được nghỉ học tạm thời vì lý do sức khoẻ (có giấy của cơ sở y tế) hoặc nghĩa vụ quân sự. Thời gian nghỉ vì lý do sức khoẻ tối đa hai học kỳ.

## Điều 2. Nghỉ học vì lý do khác
Sinh viên nghỉ học tạm thời vì lý do cá nhân phải học ít nhất một học kỳ tại trường, không thuộc diện bị kỷ luật và không nợ học phí. Thời gian nghỉ tối đa một học kỳ.

## Điều 3. Thôi học tự nguyện
Sinh viên xin thôi học nộp đơn có xác nhận của gia đình. Nhà trường giải quyết trong mười lăm ngày làm việc và cấp bảng điểm các học phần đã tích luỹ.

## Điều 4. Bảng điểm và trả hồ sơ
Sinh viên thôi học được trả lại hồ sơ gốc sau khi hoàn thành nghĩa vụ học phí và thủ tục thanh toán với thư viện, ký túc xá.`,
  },
  'quy-dinh-phuc-khao': {
    title: 'Quy định phúc khảo bài thi',
    text: `# Quy định phúc khảo bài thi

## Điều 1. Thời hạn nộp đơn phúc khảo
Sinh viên nộp đơn phúc khảo bài thi kết thúc học phần trong vòng bảy ngày kể từ ngày công bố điểm. Quá thời hạn này đơn không được tiếp nhận.

## Điều 2. Lệ phí
Mỗi bài phúc khảo nộp lệ phí theo quy định. Nếu điểm được điều chỉnh tăng, lệ phí được hoàn trả.

## Điều 3. Quy trình
Bài phúc khảo do hai giảng viên chấm độc lập, không phải giảng viên đã chấm lần đầu. Kết quả phúc khảo được công bố trong mười lăm ngày làm việc.

## Điều 4. Hiệu lực
Điểm sau phúc khảo là điểm chính thức, kể cả khi thấp hơn điểm ban đầu. Sinh viên không được phúc khảo lần hai cho cùng một bài thi.`,
  },
  'quy-dinh-quy-doi-diem': {
    title: 'Quy định quy đổi điểm và tính GPA',
    text: `# Quy định quy đổi điểm và tính GPA

## Điều 1. Thang điểm chữ
Điểm học phần quy đổi sang thang chữ: A từ 8,5 đến 10; B+ từ 8,0 đến cận 8,5; B từ 7,0 đến cận 8,0; C+ từ 6,5 đến cận 7,0; C từ 5,5 đến cận 6,5; D+ từ 5,0 đến cận 5,5; D từ 4,0 đến cận 5,0; F dưới 4,0.

## Điều 2. Thang điểm số 4
Quy đổi sang thang 4: A tương ứng 4,0; B+ 3,5; B 3,0; C+ 2,5; C 2,0; D+ 1,5; D 1,0; F 0.

## Điều 3. Điểm trung bình tích luỹ
Điểm trung bình tích luỹ tính theo trung bình có trọng số theo số tín chỉ của tất cả học phần đã tích luỹ tính đến thời điểm xét, không gồm học phần ký hiệu W hoặc R.

## Điều 4. Học phần đạt
Học phần được coi là đạt khi điểm chữ từ D trở lên; riêng học phần điều kiện tốt nghiệp phải đạt từ C trở lên.`,
  },
  'quy-dinh-chuan-tieng-anh': {
    title: 'Quy định chuẩn đầu ra tiếng Anh',
    text: `# Quy định chuẩn đầu ra tiếng Anh

## Điều 1. Yêu cầu chung
Sinh viên phải đạt chuẩn đầu ra tiếng Anh bậc 3/6 theo Khung năng lực ngoại ngữ Việt Nam hoặc chứng chỉ quốc tế tương đương còn hiệu lực trong hai năm.

## Điều 2. Chứng chỉ được công nhận
Nhà trường công nhận các chứng chỉ IELTS từ 4,5, TOEFL iBT từ 45, hoặc chứng chỉ VSTEP bậc 3 do đơn vị được Bộ cho phép tổ chức thi cấp.

## Điều 3. Thời điểm nộp
Sinh viên nộp minh chứng đạt chuẩn tiếng Anh chậm nhất trước kỳ xét tốt nghiệp một tháng. Sinh viên chưa đạt được lùi xét tốt nghiệp sang đợt sau.

## Điều 4. Miễn học phần tiếng Anh
Sinh viên có IELTS từ 6,0 trở lên khi nhập học được miễn các học phần tiếng Anh tăng cường trong chương trình.`,
  },
  // --- cặp tài liệu MÂU THUẪN (dùng cho conflicting) ---
  'quy-che-bao-luu-2023': {
    title: 'Quy chế đào tạo và bảo lưu 2023',
    text: `# Quy chế đào tạo và bảo lưu 2023

## Điều 1. Thời gian bảo lưu
Sinh viên được phép xin bảo lưu kết quả học tập tối đa hai học kỳ liên tiếp trong toàn bộ khoá học. Quá thời gian này sinh viên phải làm thủ tục thôi học tự nguyện hoặc bị xoá tên.`,
  },
  'thong-bao-bao-luu-2024': {
    title: 'Thông báo sửa đổi quy chế bảo lưu 2024',
    text: `# Thông báo sửa đổi quy chế bảo lưu 2024

## Điều 1. Quy định thời hạn mới
Áp dụng từ năm học 2024-2025: thời gian bảo lưu kết quả học tập rút ngắn xuống tối đa một học kỳ duy nhất để đảm bảo tiến độ chương trình đào tạo.`,
  },
  'huong-dan-hoc-vu': {
    title: 'Hướng dẫn học vụ sinh viên',
    text: `# Hướng dẫn học vụ sinh viên

## Mục 3. Nộp học phí
Sinh viên hoàn thành học phí trong vòng bốn tuần kể từ ngày bắt đầu học kỳ mới. Sinh viên có thể nộp qua cổng thanh toán trực tuyến của nhà trường.`,
  },
  'thong-bao-tai-chinh': {
    title: 'Thông báo thu học phí kỳ 1',
    text: `# Thông báo thu học phí kỳ 1

## Mục 1. Thời hạn thanh toán
Để phục vụ công tác xếp lịch thi, tất cả sinh viên phải hoàn thành đóng học phí trong vòng ba tuần kể từ ngày bắt đầu học kỳ.`,
  },
  'quy-dinh-gpa-tot-nghiep-2022': {
    title: 'Quy định xét tốt nghiệp 2022',
    text: `# Quy định xét tốt nghiệp 2022

## Điều 1. Ngưỡng điểm trung bình
Sinh viên được xét tốt nghiệp khi điểm trung bình tích luỹ đạt từ 2,0 trở lên theo thang 4.`,
  },
  'quy-dinh-gpa-tot-nghiep-2025': {
    title: 'Quy định xét tốt nghiệp sửa đổi 2025',
    text: `# Quy định xét tốt nghiệp sửa đổi 2025

## Điều 1. Ngưỡng điểm trung bình mới
Từ khoá tuyển sinh 2025, sinh viên chỉ được xét tốt nghiệp khi điểm trung bình tích luỹ đạt từ 2,5 trở lên theo thang 4.`,
  },
};

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

function ans(id, type, question, expectedAnswer, expectedDocuments, extraCorpus = []) {
  return {
    id,
    type,
    question,
    answerable: true,
    expectedAnswer,
    expectedDocuments,
    corpus: corpusOf([...new Set([...expectedDocuments, ...extraCorpus])]),
  };
}

function noAns(id, type, question, corpusSources) {
  return {
    id,
    type,
    question,
    answerable: false,
    expectedAnswer: null,
    expectedDocuments: [],
    corpus: corpusOf(corpusSources),
  };
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
// GHI FILE
// ---------------------------------------------------------------------------
const FILES = {
  answerable,
  'multi-hop': multiHop,
  conflicting,
  unanswerable,
  adversarial,
};

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
