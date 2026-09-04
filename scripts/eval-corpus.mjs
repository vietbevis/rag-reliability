// THƯ VIỆN CORPUS dùng chung cho scripts/gen-eval-datasets.mjs và
// scripts/gen-eval-datasets-extended.mjs — MỘT nguồn sự thật (tránh
// re-declare cùng source với text khác nhau ⇒ pipeline reject exact-dup).
//
// Nội dung MÔ PHỎNG học thuật cho mục đích đánh giá RAG, KHÔNG phải văn bản
// pháp quy / hệ thống thật.
export const CORPUS = {
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
