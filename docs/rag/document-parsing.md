# Parsing tài liệu

## Vấn đề

Tài liệu đến ở nhiều định dạng (docx, pptx, xlsx, pdf, rtf, epub, csv, html,
txt, md). RAG cần **text sạch, giữ được cấu trúc** (heading → section) để
chunking theo ngữ nghĩa ở PHASE 2. Mỗi format có cách trích xuất khác nhau và
có thể thất bại theo nhiều kiểu.

## Giải pháp

```
Upload -> detect mimeType -> ParserFactory.resolve(mimeType) -> parse(bytes)
```

| MIME                                                      | Parser                 | Output                            |
| --------------------------------------------------------- | ---------------------- | --------------------------------- |
| docx, pptx, xlsx, odt/odp/ods, rtf, epub, csv, pdf (text) | `@firecrawl/anydoc`    | Markdown GFM                      |
| text/plain, text/markdown                                 | `plaintext` (fallback) | text (md giữ nguyên)              |
| text/html                                                 | `html` (fallback)      | text (strip thẻ, decode entity)   |
| còn lại                                                   | —                      | `ParserError('UNSUPPORTED_MIME')` |

- **anydoc** (`src/documents/parsers/anydoc-parser.service.ts`): native (napi),
  import tĩnh. Nhận diện format theo thứ tự: nội dung → tên file → MIME type
  (cần cho CSV vì CSV không có chữ ký).
- Lỗi anydoc được map sang `ParserError` có code: `NEEDS_OCR`, `ENCRYPTED`,
  `MALFORMED`, `UNSUPPORTED_MIME`, `PARSE_FAILED`, `EMPTY_OUTPUT`.
- `ParsedDocument` = `{ markdown, text, parser, warnings[], metadata }`.

## OCR

PDF scan → anydoc reject với `needsOcr`. Đặt `ANYDOC_OCR=hosted` +
`FIRECRAWL_API_KEY` để gửi qua Firecrawl Parse. Mặc định `reject` (tài liệu
không rời máy).

## Failure modes (PROMPT §54)

| Tình huống                   | Kết quả                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| anydoc parse lỗi             | `ParserError` cụ thể → document `FAILED` với `rejectedReason` |
| MIME không hỗ trợ            | `UNSUPPORTED_MIME` → `FAILED`                                 |
| PDF cần OCR mà chưa bật      | `NEEDS_OCR` → `FAILED` (đổi config rồi re-ingest)             |
| anydoc native lib không load | crash lúc boot (rõ ràng) — không giấu                         |

## Benchmark

Đo `parsing latency` (anydoc single-digit ms cho file nhỏ) trong
`IngestionJob.metrics.ms` của stage `PARSE`. So sánh output các parser trên
cùng tài liệu ở PHASE 10 (chunking/retrieval metrics phụ thuộc chất lượng
parse).
