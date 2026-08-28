import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { DocumentQualityService } from './document-quality.service';

function make(threshold = 0.7): DocumentQualityService {
  const config = {
    get: () => ({ qualityThreshold: threshold }),
  } as unknown as ConfigService<AppConfig, true>;
  return new DocumentQualityService(config);
}

const TOPICS = [
  'điều kiện xét tốt nghiệp',
  'quy trình đăng ký học phần',
  'chính sách học bổng khuyến khích',
  'thủ tục bảo lưu kết quả học tập',
  'quy định về đánh giá rèn luyện',
  'cơ chế phúc khảo bài thi',
  'điều kiện chuyển ngành đào tạo',
  'quy chế thực tập tốt nghiệp',
];
const goodText = Array.from(
  { length: 24 },
  (_, i) =>
    `Điều ${i + 1}. Nhà trường ban hành hướng dẫn chi tiết về ${
      TOPICS[i % TOPICS.length]
    } áp dụng từ năm học ${2020 + (i % 5)}, sinh viên cần nộp hồ sơ trước ${
      7 + (i % 20)
    } ngày.`,
).join('\n\n');

describe('DocumentQualityService', () => {
  it('tài liệu tốt: valid, score cao, không issue', () => {
    const r = make().assess({ text: goodText, title: 't', source: 's' });
    expect(r.valid).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.issues).toHaveLength(0);
  });

  it('tài liệu rỗng: EMPTY_DOCUMENT, invalid, score 0', () => {
    const r = make().assess({ text: '', title: 't', source: 's' });
    expect(r.valid).toBe(false);
    expect(r.score).toBe(0);
    expect(r.issues.map((i) => i.type)).toContain('EMPTY_DOCUMENT');
  });

  it('quá ngắn: TOO_SHORT (ERROR) -> invalid', () => {
    const r = make().assess({ text: 'Ngắn.', title: 't', source: 's' });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.type)).toContain('TOO_SHORT');
  });

  it('hỏng mã hoá: BROKEN_ENCODING (ERROR) -> invalid', () => {
    const r = make().assess({
      text: `${goodText} ���`,
      title: 't',
      source: 's',
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.type)).toContain('BROKEN_ENCODING');
  });

  it('thiếu metadata: WARNING, vẫn có thể valid nếu score đủ', () => {
    const r = make().assess({ text: goodText });
    expect(r.issues.map((i) => i.type)).toContain('MISSING_METADATA');
  });

  it('quá nhiều ký hiệu: EXCESSIVE_SYMBOLS', () => {
    const r = make(0).assess({
      text: '### @@@ $$$ %%% ^^^ &&& *** ((( ))) !!! ??? ||| ~~~ >>> <<< ///',
      title: 't',
      source: 's',
    });
    expect(r.issues.map((i) => i.type)).toEqual(
      expect.arrayContaining(['EXCESSIVE_SYMBOLS']),
    );
  });

  it('ngưỡng cấu hình được: threshold cao làm tài liệu trung bình fail', () => {
    const shortish =
      'Một tài liệu vừa đủ dài để qua kiểm tra độ dài tối thiểu nhưng không nhiều nội dung.';
    const lenient = make(0.5).assess({ text: shortish });
    const strict = make(0.95).assess({ text: shortish });
    expect(lenient.valid).toBe(true);
    expect(strict.valid).toBe(false);
  });
});
