# KHẮC PHỤC AUDIT — ĐỢT PRODUCTION READINESS (2026-08-29)

Đối chiếu từng finding của bản audit (agy) và trạng thái sau khắc phục.
Baseline trước đợt: 60 suite / 408 test. Sau đợt: **65 suite / 443 test, typecheck sạch, lint không phát sinh lỗi mới.**

## P0 — Đã sửa

### [P0-1] Contradiction detector phá điểm faithfulness
- **Xác minh:** ĐÚNG. `faithfulness.service.ts` lặp `detectClaimChunkContradiction(claim, chunk)` trên **toàn bộ** context, và `NEGATION_PAIRS` dùng từ đơn ("được"/"phải") → mọi quy chế có điều khoản cấm đánh sập câu trả lời khẳng định hợp lệ thành `CONFLICTING_EVIDENCE` (faithfulness = 0.0).
- **Sửa:**
  1. `faithfulness.service.ts` — heuristic contradiction CHỈ đối chiếu claim với **evidence chunk đã match của chính nó** (`evidenceChunkIds`), không quét toàn context.
  2. Ở chế độ `auto`/`llm`, mâu thuẫn heuristic chỉ là **ứng viên**, phải được NLI LLM xác nhận mới thành verdict `CONTRADICTED`. Chỉ chế độ `heuristic` thuần mới tin verdict heuristic một mình.
  3. `contradiction-detector.ts` — thay `NEGATION_PAIRS` từ đơn bằng **cụm từ** (`"không được phép"`, `"được phép"`…); hàm `polarity()` loại cụm phủ định trước khi dò cụm khẳng định (phân biệt "không được phép" ≠ "được phép"); chỉ báo mâu thuẫn khi hai bên có cực RÕ RÀNG và NGƯỢC nhau (chunk chứa cả hai cực → bỏ qua).
  4. **`detectContextMutualContradiction`** (phát hiện khi benchmark thật với corpus nhiều số liệu — cùng họ lỗi P0-1): heuristic số liệu báo nhầm khi hai chunk KHÁC chủ đề cùng chứa số (vd GPA `2,0` ở điều này, `2,5` ở điều khác). Sửa: chuẩn hoá số Việt → digit; chỉ so **cụm đơn vị 2 từ** ("học kỳ liên tiếp", "tín chỉ tích luỹ") thay vì từ đơn; yêu cầu **Jaccard token nội dung ≥ 0.4** giữa 2 chunk (cùng chủ đề); nếu chunk liệt kê nhiều mốc chứa giá trị của claim thì KHÔNG mâu thuẫn. Trong `faithfulness.service.ts`, mâu thuẫn context heuristic chỉ **authoritative ở chế độ `heuristic` thuần**; chế độ `auto`/`llm` thì `CONFLICTING_EVIDENCE` chỉ do verdict `CONTRADICTED` của NLI quyết.
- **Test hồi quy:** `faithfulness.service.spec.ts` ("claim khẳng định + chunk cấm KHÔNG phải evidence → KHÔNG mâu thuẫn"; "auto: hai chunk khác chủ đề cùng chứa số → KHÔNG CONFLICTING_EVIDENCE"), `contradiction-detector.spec.ts`.

### [P0-2] Deduplication deadlock khi ingest lỗi giữa chừng
- **Xác minh:** ĐÚNG. `document-deduplicator.service.ts` chỉ loại `[REJECTED, FAILED]`; document kẹt ở `EMBEDDING` (giữ cố ý để retry `/embed`) chặn vĩnh viễn mọi lần upload/seed lại cùng checksum.
- **Sửa:** dedup chỉ khoá được bản mới nếu document đối chiếu là `COMPLETED`, hoặc đang xử lý mà `updatedAt` còn trong `INGESTION_STALE_AFTER_MS` (mặc định 15 phút). Document mồ côi (in-progress quá hạn) được **thu hồi về `FAILED`** kèm lý do và không chặn bản mới. Trả thêm field `reclaimed`.
- **Test:** `document-deduplicator.service.spec.ts` viết lại toàn bộ (COMPLETED khoá; in-progress còn mới khoá; in-progress quá hạn → thu hồi + không khoá).

## P1 — Đã sửa

### [P1-1] Keyword FTS trả 0 kết quả trên câu hỏi tự nhiên
- **Sửa:** `common/utils/text.util.ts::toKeywordQuery()` — bỏ cụm/từ nghi vấn ("mấy", "bao nhiêu", "như thế nào"…) và hư từ, nối token nghĩa bằng toán tử `or` cho `websearch_to_tsquery` (không còn ép AND toàn bộ). Giữ nguyên mã văn bản/số quyết định. Fallback query gốc nếu lọc hết token.
- **Test:** `text.util.spec.ts`.

### [P1-2] Hardcode vector(1536), thiếu tiền tố E5
- **Quyết định:** migrate sang **intfloat/multilingual-e5-large (1024d)** ngay.
- **Sửa:**
  - Migration `20260829120000_phase14_embedding_e5_1024` — DROP index, TRUNCATE `Embedding`, `ALTER COLUMN vector(1024)`, tạo lại HNSW, đưa Document đã có chunk về `CHUNKING` để re-embed. Kèm index FK `Citation.documentId/chunkId` (DATABASE_REVIEW §3.1).
  - `EMBEDDING_DIMENSION` mặc định = 1024.
  - `EmbeddingService` — tham số `inputType: 'query' | 'passage'`; tự thêm `"query: "` / `"passage: "` khi tên model chứa "e5", hoặc theo `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_PASSAGE_PREFIX`.
- **Việc vận hành:** `npm run prisma:deploy` rồi re-embed corpus.
- **Test:** `embedding.service.spec.ts`.

### [P1-3] Golden dataset N=18
- **Sửa:** `scripts/gen-eval-datasets.mjs` — thư viện 22 tài liệu quy chế mô phỏng + **111 case** (`npm run eval:datasets:gen`):
  - answerable 57, multi-hop 18, conflicting 6, unanswerable 15, adversarial 15.
- **Sai số mẫu:** `metrics/statistics.ts::bootstrapCI()` (bootstrap 95%, RNG có seed → tất định); `evaluation.service` xuất `passRateCI95Low/High/MarginOfError`.
- **Test:** `golden-datasets.spec.ts` (validate toàn bộ JSONL + đếm ≥ 100), `statistics.spec.ts`.

## P2 — Đã sửa / làm rõ

### [P2-1] Thiếu rate limiting + auth
- **Rate limiting:** `@nestjs/throttler` + `common/rate-limit/rate-limit.module.ts` — hai named throttler (`default` 120/60s, `rag` 20/60s cho `/rag/query|search`). Tắt bằng `RATE_LIMIT_ENABLED=false`. Health check `@SkipThrottle()`.
- **Auth:** theo quyết định — **chỉ throttler**, giả định deploy sau API gateway lo auth. Chưa thêm guard.
- **File size limit:** audit nói thiếu — thực tế **đã có** (`MAX_UPLOAD_BYTES = 25MB` trong `documents.controller.ts`).

### [P2-2] Citation FK violation
- **Xác minh:** phần lớn đã xử lý sẵn (`persistCitations` lọc `validChunkIds/validDocIds`). Lỗi E2E là do test isolation, không phải prod bug. Đã bổ sung index FK (xem P1-2).

## P3 / Kiến trúc

### [P3-1] Semantic chunker
- **Sửa:** `semantic-chunker.service.ts` — tách câu → embedding có đệm → cắt tại phân vị khoảng cách (`SEMANTIC_BREAKPOINT_PERCENTILE`) → ép khoảng token. Fallback đóng gói đoạn khi embedding chưa cấu hình / lỗi. `CHUNKING_STRATEGY=semantic`.
- **Test:** `semantic-chunker.service.spec.ts`.

### [ARCH §5.3] Gộp LLM call
- **Sửa:** `GROUNDED_SCHEMA` trả thêm `claims[]`; `RagPipelineService` bỏ lời gọi `ClaimExtractor` riêng khi generation đã trả claim (`RAG_CONSOLIDATE_CLAIMS=true`). Fallback về `ClaimExtractor` khi tắt cờ / generation không trả claim. Bỏ ~1 lời gọi LLM mỗi truy vấn có citation.
- **Test:** `answer-generation.service.spec.ts`, `rag-pipeline.service.spec.ts` ("gộp call: KHÔNG gọi ClaimExtractor riêng").

### [ARCH §5.1] Async ingestion queue
- **Chưa làm** (ngoài scope đợt này theo quyết định). Vẫn đồng bộ trong HTTP request; đã có file-size limit 25MB giảm rủi ro timeout.

## Benchmark thực đo sau khắc phục

`LLM=Ollama qwen2.5:7b` · `EMBEDDING=Ollama zylonai/multilingual-e5-large (1024d)` ·
pgvector HNSW · `.env` mặc định · 2026-08-29 · `npm run evaluate -- --baseline`.

| Dataset | N | passRate | Recall@5 | MRR | NDCG@5 | Abstention | AnswerCorr | Faithfulness | ClaimHalluc | HallucProxy | P50 latency |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| answerable | 57 | 0.77 | 0.991 | 1.00 | 0.984 | 1.00 | 0.877 | **0.983** | 0.018 | 0.00 | 17.8s |
| multi-hop | 18 | 0.44 | 0.926 | 0.972 | 0.904 | 0.778 | 0.472 | 0.964 | 0.036 | 0.056 | 18.3s |
| conflicting | 6 | 1.00 | 1.00 | 0.833 | 0.871 | 1.00 | 0.667 | 0.833 | 0.167 | 0.00 | 31.8s |
| adversarial | 15 | 0.87 | — | — | — | 0.867 | — | 0.750 | 0.25 | 0.133 | 6.6s |
| unanswerable | 15 | 1.00 | — | — | — | 1.00 | — | — | — | 0.00 | 10.3s |

**Xác nhận các fix có tác dụng:**
- Faithfulness answerable **0.0 → 0.983**, claim hallucination **0.667 → 0.018** (P0-1).
- Recall@5 conflicting **0.0 → 1.0**, passRate **0 → 1.0** (P0-2 dedup deadlock).
- MRR answerable **0.467 → 1.0**, NDCG **0.599 → 0.984** (P1-2 e5-large + prefix).
- Hallucination proxy **0.0** trên answerable/conflicting/unanswerable.

**Còn yếu (giới hạn model 7B, không phải bug):** multi-hop passRate 0.44 (suy luận
đa chặng), citationAccuracy answerable 0.67 (trích chunk liên quan ≠ gold — 13/57
rớt pass-gate dù nội dung đúng), adversarial 2/15 trả lời tiền đề sai.

## Ghi chú vận hành sau khi merge
1. `npm install` (thêm `@nestjs/throttler`).
2. `npm run prisma:deploy` — chạy migration e5 1024d (TRUNCATE Embedding).
3. Cấu hình `.env` trỏ Ollama e5-large (đã có mẫu trong `.env.example`), re-embed corpus.
4. `npm run eval:datasets:gen` nếu chỉnh corpus/case.
