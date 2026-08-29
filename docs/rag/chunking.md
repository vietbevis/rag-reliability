# Chunking (PHASE 2)

## Vấn đề

Chunk sai làm hỏng cả pipeline: chunk quá lớn pha loãng tín hiệu khi retrieval;
quá nhỏ mất ngữ cảnh; cắt giữa câu/bảng làm LLM hiểu sai; chunk thiếu heading
khiến không biết "điều này thuộc chương nào". Cần chunk **bám cấu trúc** và
**đo được chất lượng** (PROMPT §12, §13).

## Hai chiến lược (đổi bằng `CHUNKING_STRATEGY`)

### `fixed` — baseline (PROMPT §35)

`RecursiveCharacterTextSplitter` (LangChain) với hàm đo độ dài theo **token**
(dùng chung `TokenCounterService` để nhất quán cost tracking).
`chunkSize = CHUNK_MAX_TOKENS`, `chunkOverlap = CHUNK_OVERLAP_TOKENS`. Không
quan tâm cấu trúc — đây là mốc để so sánh.

### `structure` — mặc định (PROMPT §12)

```
Markdown (anydoc) -> parseMarkdownSections
  section = { headingPath[], level, blocks[] }   blocks: paragraph | code | table | list | quote
-> chunkSection: gói block theo token, KHÔNG cắt giữa block nếu block <= max
   - block > max  -> tách theo câu (hoặc dòng cho code/table) + overlap
   - section < CHUNK_MIN_TOKENS -> gộp vào chunk trước nếu cùng nhánh heading & tổng <= max
-> mỗi chunk mang `heading` + breadcrumb `section` ("Quy chế > Chương I > Điều 5")
```

`splitReason` trong metadata: `section-fit` · `section-packed` ·
`block-oversized-split` · `small-section-merged` · `fixed-window`.

**Metadata bảng (P4 — retrieval bảng):** chunk chứa bảng GFM mang `hasTable: true`.
Bảng lớn bị cắt thành nhiều mảnh (`block-oversized-split`) mang chung
`tableGroup: "tg<n>"` (bộ đếm xuyên suốt document) — để `TableExpansionService`
kéo lại đủ mọi mảnh khi 1 mảnh lọt context (xem `retrieval.md`).

> Text gửi qua field `text` mặc định coi là `text/markdown` (plain text là tập
> con hợp lệ của Markdown) để chunker structure tận dụng được `#` heading.
> File `.txt` thật vẫn là plaintext → chunker structure coi toàn bộ là 1 section
> level 0.

## Chunk quality (`chunk-quality.service.ts`, PROMPT §13)

`assess()` → `{ score ∈ [0,1], flags[] }`. **Không loại bỏ chunk** — chỉ gắn cờ
để retrieval/reranking và benchmark dùng.

| Flag                  | Điều kiện                                              |
| --------------------- | ------------------------------------------------------ |
| `TOO_SHORT`           | tokenCount < `CHUNK_MIN_TOKENS`                        |
| `TOO_LONG`            | tokenCount > `CHUNK_MAX_TOKENS` × 1.15                 |
| `MISSING_CONTEXT`     | không có heading/section                               |
| `STARTS_MID_SENTENCE` | bắt đầu bằng chữ thường (không phải marker)            |
| `ENDS_MID_SENTENCE`   | kết thúc không phải dấu câu / `\|`                     |
| `HIGH_NOISE`          | tỉ lệ ký tự lạ > 35%                                   |
| `DUPLICATE`           | trùng chunk khác trong cùng document (normalized hash) |

## Lưu trữ

`DocumentChunk`: `content`, `contentHash`, `sequence`, `tokenCount`, `heading`,
`section`, `page`, `qualityScore`, `metadata` (`headingPath`, `headingLevel`,
`splitReason`, `strategy`, `qualityFlags`, `isDuplicate`).
`@@unique([documentId, sequence])`. Re-chunk = xoá hết rồi tạo lại (transaction).

Sau chunking, document chuyển `VALIDATING → CHUNKING` (chờ PHASE 3 embedding).
Stage `CHUNK` ghi `IngestionJob.metrics` = `{ strategy, chunkCount, totalTokens, ms }`.

## API

- `POST /documents` → auto ingest **+ chunk** nếu đạt (VALIDATING).
- `POST /documents/:id/chunk` `{ "strategy": "fixed" }` → chunk lại với chiến
  lược chỉ định (dùng để benchmark).
- `GET /documents/:id/chunks?take=&skip=` → danh sách chunk.

## Benchmark — Experiment 001 (PROMPT §36)

_Fixed vs Structure-aware_: chunk cùng corpus bằng cả hai, chạy golden dataset,
so Recall@5 / MRR / NDCG / Context Precision / Faithfulness / Hallucination
Rate / avg chunk quality / số chunk / latency. Kỳ vọng structure-aware tăng
Context Precision và giảm "cắt giữa semantic unit".
