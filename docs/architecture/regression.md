# Regression Testing & CI Gate (PHASE 12)

> Quy chuẩn phát hiện suy giảm chất lượng RAG và tự động chặn merge / fail CI
> (PROMPT §37).

## 1. Nguyên tắc

Bất kỳ sự thay đổi nào về:
- Chiến lược chunking
- Embedding model
- Retriever / Fusion logic
- Reranker
- Prompt kỹ thuật
- LLM Provider hoặc Model

đều phải được đánh giá đối sánh với **Baseline (`isBaseline = true`)** của golden dataset tương ứng.

---

## 2. Ngưỡng Hồi quy (Regression Thresholds)

Khi chạy so sánh (`POST /evaluation/runs/:id/compare` hoặc `npm run evaluate`), hệ thống sẽ đánh dấu `regressed = true` và ném lỗi nếu vi phạm bất kỳ tiêu chí nào sau đây:

| Metric | Hướng | Ngưỡng vi phạm | Diễn giải |
| :--- | :---: | :---: | :--- |
| **`recallAt5`** | Giảm | $> 0.05$ (5%) | Khả năng tìm kiếm trúng bằng chứng bị suy giảm |
| **`hallucinationRateProxy`** | Tăng | $> 0.03$ (3%) | Tỷ lệ bịa đặt / sinh thông tin ngoài lề gia tăng |
| **`faithfulness`** | Giảm | $> 0.05$ (5%) | Mức độ trung thực của câu trả lời so với context bị giảm |
| **`contextPrecision`** | Giảm | $> 0.05$ (5%) | Ngữ cảnh nạp vào chứa nhiều chunk rác/nhiễu hơn |
| **`avgLatencyMs`** | Tăng | $> 1.5\times$ (+50%) | Độ trễ pipeline tăng vọt không kiểm soát |

---

## 3. Quy trình CI/CD & Baseline Promotion

### 3.1. Thiết lập Baseline
Khi hoàn thành một mốc kiến trúc ổn định:
```bash
# Chạy đánh giá và chốt làm baseline
npm run evaluate -- --baseline
```
Hoặc gọi qua REST API:
```http
POST /evaluation/runs/:id/set-baseline
```

### 3.2. Kiểm tra CI tự động
Trong CI workflow:
```bash
# Chạy đánh giá full và so sánh baseline (exit code != 0 nếu regressed)
npm run evaluate
```
