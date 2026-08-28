# Data cleaning & quality (PHASE 1)

## Vấn đề

"Garbage in, garbage out." Nếu tài liệu bẩn (OCR noise, header/footer lặp, số
trang, mã hoá hỏng, đoạn trùng lặp) đi thẳng vào chunking → embedding, thì
retrieval kéo về rác và LLM hallucinate dù pipeline sau đúng. Cần **làm sạch có
kiểm soát** và **chặn tài liệu không đạt** trước khi embedding (PROMPT §9-11).

> Nguyên tắc: không sửa dữ liệu quan trọng một cách âm thầm. Mỗi phép biến đổi
> đều được ghi lại (`Document.transformations`).

## Pipeline

```
RawDocument (bytes)
  -> Parse (anydoc -> Markdown | fallback -> text)
  -> Normalize   (an toàn: mã hoá, ký tự vô hình, xuống dòng)
  -> Clean       (page number, boilerplate, OCR noise, đoạn trùng, md noise)
  -> Deduplicate (checksum exact + normalized-hash near)
  -> Quality     (score + issues; < ngưỡng hoặc lỗi ERROR -> REJECT)
  -> CleanDocument  (status VALIDATING, chờ PHASE 2 chunking)
```

Trạng thái document: `UPLOADED → PARSING → CLEANING → VALIDATING` (thành công)
· `REJECTED` (dedup exact / quality fail) · `FAILED` (parse lỗi).
Mỗi stage ghi một `IngestionJob` kèm `metrics.ms`.

## Normalize (`document-normalizer.service.ts`)

An toàn về ngữ nghĩa, không xoá nội dung: NFC (quan trọng cho tiếng Việt),
strip BOM / zero-width / soft-hyphen / control chars, CRLF→LF, khoảng trắng
Unicode → space, trim trailing, gộp dòng trống.

## Clean (`document-cleaner.service.ts`)

Với Markdown: bảo toàn heading / list / code fence / bảng / separator.

| Phép                              | Mô tả                                                |
| --------------------------------- | ---------------------------------------------------- |
| `remove:page-numbers`             | dòng chỉ chứa số trang ("12", "- 3 -", "Trang 4/10") |
| `remove:repeated-headers-footers` | dòng ngắn (<80), không heading, lặp ≥3 lần → giữ 1   |
| `fix:hyphenated-linebreaks`       | "thông-\ntin" → "thôngtin"                           |
| `fix:broken-lines`                | (chỉ text thô) nối câu bị ngắt giữa dòng             |
| `remove:ocr-artifact-lines`       | dòng có >40% ký tự không phải chữ/số                 |
| `remove:duplicate-paragraphs`     | đoạn văn trùng liên tiếp → giữ 1                     |
| `remove:markdown-noise`           | HTML comment, link rỗng `[]()`, escape thừa `\_`     |

## Deduplicate (`document-deduplicator.service.ts`)

- **EXACT**: cùng `checksum` (SHA-256 bytes gốc) → document mới `REJECTED`,
  `duplicateOfId` trỏ về bản gốc.
- **NEAR**: cùng `normalizedHash` (hash text đã chuẩn hoá) → vẫn xử lý, thêm
  issue `DUPLICATE_CONTENT` + `duplicateOfId`.
- Chưa dùng ML (MinHash/SimHash) ở phase này — sẽ thêm khi cần.

## Quality (`document-quality.service.ts`)

`assess()` → `{ score ∈ [0,1], valid, issues[] }`.
`valid = score >= QUALITY_THRESHOLD` **và** không có issue mức `ERROR`.

| Issue               | Mức     | Ý nghĩa                 |
| ------------------- | ------- | ----------------------- |
| `EMPTY_DOCUMENT`    | ERROR   | rỗng sau khi clean      |
| `TOO_SHORT`         | ERROR   | < 40 ký tự              |
| `BROKEN_ENCODING`   | ERROR   | có U+FFFD               |
| `SHORT_DOCUMENT`    | WARNING | < 200 ký tự             |
| `OCR_NOISE`         | WARNING | tỉ lệ chữ cái < 50%     |
| `EXCESSIVE_SYMBOLS` | WARNING | ký hiệu > 30%           |
| `DUPLICATE_CONTENT` | WARNING | lặp 8-gram nội bộ > 65% |
| `MISSING_METADATA`  | WARNING | thiếu title/source      |

Ngưỡng và trọng số phạt cấu hình được (hiện hard-code trong service + env
`QUALITY_THRESHOLD`); PHASE 10 sẽ tune bằng benchmark.

## Failure modes

| Stage        | Khi lỗi                                            |
| ------------ | -------------------------------------------------- |
| Parse        | fallback parser → vẫn lỗi → `FAILED` + code cụ thể |
| Dedup EXACT  | `REJECTED` (không phí công embedding)              |
| Quality fail | `REJECTED`, `qualityReport` được lưu để debug      |
| Lỗi bất ngờ  | `FAILED`, `rejectedReason` = lỗi                   |

## Benchmark (PHASE 10)

Câu hỏi cần trả lời bằng số: _data cleaning ảnh hưởng Recall@5 bao nhiêu?_ →
chạy cùng golden dataset với cleaning bật/tắt, so Recall / Faithfulness /
Hallucination Rate.
