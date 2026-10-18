# Rule trước, LLM cho ca khó, người duyệt khi bị chặn (HITL)

## Luồng xử lý trong `evaluate`

```
Field cần cho rule
  ├─ Người duyệt đã sửa (correct_field)        → dùng giá trị người, KHÔNG gọi LLM
  ├─ Extraction đã cấu trúc đủ                  → RULE deterministic xử lý
  └─ Còn trống/"unknown" nhưng có văn bản nguồn  → ca khó
        ├─ Văn bản có câu dạng chỉ dẫn (injection)         → HITL: SUSPECTED_PROMPT_INJECTION (không gửi LLM)
        ├─ Chưa cấu hình LLM                               → HITL: SEMANTIC_PROVIDER_UNAVAILABLE
        ├─ LLM không phản hồi trong budget                 → HITL: PROVIDER_UNAVAILABLE
        ├─ Guard từ chối (quote bịa, thiếu căn cứ chữ...)  → HITL: LLM_OUTPUT_REJECTED
        ├─ LLM mâu thuẫn giá trị đã trích                  → HITL: LLM_CONFLICT
        └─ Qua guard                                        → rule dùng kết quả, gắn LLM_ASSISTED
```

Hiện tại ca khó được nhận diện cho **điều khoản thanh toán của hợp đồng** (`contract.payment_condition`), là phần ngữ nghĩa được Specs §5 giao cho LLM. MST, số tham chiếu, tiền và ngày luôn do code kiểm, không bao giờ do LLM quyết định.
Khi bị chặn, rule vẫn chạy tiếp với dữ liệu deterministic (thường cho kết quả `unknown`). Run vẫn `completed` vì đây là `unknown` nghiệp vụ, không phải lỗi kỹ thuật.

## Hàng chờ người duyệt (backend/UI — Đức)

Một assessment cần người xem khi thỏa **ít nhất một** điều kiện:

1. `proposal == "unknown"`;
2. `reason_codes` chứa `REVIEW_REQUIRED`;
3. Có `diagnostics` với code thuộc: `SUSPECTED_PROMPT_INJECTION`, `LLM_OUTPUT_REJECTED`, `LLM_CONFLICT`, `PROVIDER_UNAVAILABLE`, `SEMANTIC_PROVIDER_UNAVAILABLE` (diagnostic có `document_id` và `field_key` để mở đúng nguồn).

Ngoài ra, `LLM_ASSISTED` **không** chặn luồng, nhưng UI nên hiển thị nhãn "AI đọc ngữ nghĩa — xác nhận khi quyết định" cạnh đề xuất.

## Người duyệt xử lý thế nào

| Tình huống | Hành động (đều đã có trong contract 1.0.2) |
|---|---|
| Đọc nguồn và thấy giá trị đúng | `correct_field` cho field đó, kèm `reason` (và evidence nếu có), rồi chạy lại run. Rule dùng giá trị người duyệt, không gọi LLM |
| Tài liệu có nội dung đáng ngờ | Mở trang nguồn; yêu cầu bổ sung bản khác, hoặc `dismiss` có lý do |
| Đề xuất `candidate_resolved` có `LLM_ASSISTED` | Đối chiếu nguồn trước khi `resolve` |

AI **không** ghi `human_status`. Mọi chuyển trạng thái do backend thực hiện sau khi người duyệt thao tác.

## Bằng chứng

- Test không gọi mạng: `tests/test_hybrid_hitl.py` (ca dễ không gọi LLM; ca khó gọi đúng 1 lần; 5 nhánh HITL; người sửa đóng vòng).
- Smoke với Gemini thật: `scripts/hybrid_smoke.py` → `evidence/hybrid-smoke-*.json`.
