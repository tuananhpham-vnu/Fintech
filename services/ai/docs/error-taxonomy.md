# Error taxonomy — bàn giao 21:00 cho Đức và Nguyên (T13b)

Hai lớp khác nhau, **không trộn**:

1. **Lỗi kỹ thuật (HTTP):** request không xử lý được. Worker ghi job failed, không publish kết quả.
2. **Reason code nghiệp vụ:** evaluate chạy xong, rule trả `unknown`/`issue` có lý do. Run vẫn `completed`, trừ khi có rule crash.

## 1. HTTP từ service AI nội bộ (`/internal/v1/*`)

| HTTP | code | Ý nghĩa | Backend nên làm |
|---|---|---|---|
| 403 | `FORBIDDEN` | Thiếu hoặc sai `X-Internal-Key`; service chưa cấu hình key | Lỗi cấu hình, không retry |
| 422 | `INVALID_REQUEST` | Body sai schema 1.0.2; `details[].path` là JSON pointer | Bug producer, không retry |
| 422 | `INVALID_MODEL_OUTPUT` | Output AI sai schema hoặc trượt guard (evidence ngoài snapshot, `issue_id` sai, có `human_status`, ...) | Job failed, **không coi là pass** |
| 503 | `PROVIDER_UNAVAILABLE` | Provider/package chưa có hoặc hết retry; mock không có gold cho input | Retry hữu hạn theo lease; không tự chuyển mock |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (không có stack trace) | Job failed |

Extraction (Nguyên) có thể trả thêm theo catalogue: `PDF_ENCRYPTED`, `PDF_INVALID`, `INVALID_EVIDENCE`.

## 2. Run status

| `status` | Khi nào | Hệ quả |
|---|---|---|
| `completed` | Mọi rule chạy xong (kể cả rule `unknown` nghiệp vụ) | Được publish nếu không stale |
| `partial` | ≥1 rule crash → rule đó `unknown` + `INTERNAL_RULE_ERROR` | Mọi candidate bị hạ về `unknown` + `RUN_PARTIAL`; **không resolve từ partial** |

## 3. Reason codes nghiệp vụ (trong `RuleResult.reason_codes` khi unknown/n/a, và `IssueAssessment.reason_codes`)

| Rule | Codes |
|---|---|
| R01 | `MISSING_DOCUMENT`, `DOCUMENT_PROVIDED`, `UNREADABLE_SOURCE`, `NEEDS_CLASSIFICATION`, `DOCUMENT_NOT_READY` |
| R02 | `BORROWER_TAX_ID_MISMATCH`, `IDENTITY_CONFIRMED`, `TAX_ID_UNREADABLE`, `TAX_ID_FORMAT_UNRECOGNIZED`, `NO_BORROWER_IDENTITY` |
| R08 | `MISSING_ACCEPTANCE`, `ACCEPTANCE_SUPPORTED`, `PARTIAL_ACCEPTANCE`, `OTHER_CONDITIONS_UNRESOLVED`, `{SUPPLEMENT,ACCEPTANCE}_{CONTRACT,PARTY,SCOPE}_MISMATCH`, `{CONTRACT,PARTY,SCOPE}_UNCLEAR`, `AMOUNT_UNCLEAR`, `AMOUNT_EXCEEDS_CONTRACT`, `ACCEPTANCE_DATE_UNCLEAR`, `CURRENCY_UNCLEAR`, `UNSUPPORTED_CURRENCY`, `NO_RECEIPT_CLAIM`, `NOT_ACCEPTANCE_CONDITION`, `CLAIM_TYPE_UNCLEAR`, `RECEIPT_REF_OR_SCOPE_UNCLEAR`, `CONTRACT_NOT_FOUND`, `AMBIGUOUS_CONTRACT`, `CONTRACT_BORROWER_NOT_VERIFIED`, `PAYMENT_CONDITION_UNCLEAR`, `RECEIPT_SCOPE_NOT_IN_CONTRACT`, `MULTIPLE_LOAN_REQUESTS` |
| R09 | `PAYMENT_SUPPORTED`, `PARTIAL_PAYMENT`, `MULTIPLE_PAYMENTS_REQUIRE_SUM`, `AMOUNT_EXCEEDS_CLAIM`, `RECEIVED_WITHOUT_PAYMENT_RECORD`, `MISSING_PAYMENT_RECORD`, `{CONTRACT,PAYEE,PAYER}_MISMATCH`, `{CONTRACT,PAYEE,PAYER}_UNCLEAR`, `PAYMENT_STATUS_NOT_COMPLETED`, `CLAIM_AMOUNT_UNCLEAR` |
| R10 | `UNSUPPORTED_REQUEST_TYPE`, `AWAITING_RESPONSE`, `SUBJECT_CHANGED`, `REVIEW_REQUIRED` |
| Chung | `INTERNAL_RULE_ERROR`, `RUN_PARTIAL`, `SUBJECT_CHANGED`, `REVIEW_REQUIRED`, `UNREADABLE_SOURCE` |
| Ca khó / HITL ([hitl.md](hitl.md)) | `LLM_ASSISTED`, `SUSPECTED_PROMPT_INJECTION`, `SEMANTIC_PROVIDER_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `LLM_OUTPUT_REJECTED`, `LLM_CONFLICT`, `CONDITION_SOURCE_MISSING`; cũng xuất hiện trong `diagnostics` (kèm `document_id`, `field_key`) |

UI (Đức) hiển thị theo `category`/`proposal` và dùng `reason_codes` để chọn thông điệp. **Không parse `summary`.**

## 4. Expected output

- Gold G01–G03: `packages/contracts/fixtures/golden-cases.json` (`expected`).
- Output thật của evaluator cho gold và các biến thể (unknown/partial/mismatch/missing): chạy `scripts/export_evaluator_outputs.py` → `evidence/evaluator-outputs/`.
