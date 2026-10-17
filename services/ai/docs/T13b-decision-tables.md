# T13b — Decision tables 5 rule P0 (Contracts/Specs 1.0.2)

Nguồn: Specs §2, §10, §11; Contracts §9.2, §10. Code tương ứng: `services/ai/rules/`. Test: `tests/test_rules.py`.
Mỗi bảng đọc **từ trên xuống, dòng đầu tiên khớp thì dừng**. "Assessment" chỉ tạo khi có vấn đề, hoặc khi có `existing_issue` cùng key.
Hồ sơ sạch ngay từ đầu không tạo issue chỉ để `candidate_resolved`.

Quy ước chung:

- `issue_id = UUIDv5(254068b3-5226-4c48-86c1-42c8c85cd381, case_id + ":" + issue_key)`.
- `reason_codes` của RuleResult chỉ ghi khi `unknown`/`not_applicable`. Với pass/issue, lý do nằm trong assessment (khớp gold).
- Severity chỉ là mức ưu tiên xem xét, không phải điểm rủi ro tín dụng. `high` khi khai *đến hạn*/*đã thu* mà thiếu căn cứ, hoặc khi sai doanh nghiệp.
- Normalize: NFC + trim. MST giữ 10 hoặc 10-3 chữ số. Ref/scope viết hoa, bỏ khoảng trắng, giữ dấu gạch (`HĐ01-A` ≠ `HĐ01`). Tiền là `Decimal`. Ngày chỉ nhận ISO.
- Rule crash → rule đó `unknown`/`INTERNAL_RULE_ERROR`, run `partial`, và **mọi candidate bị hạ về `unknown`** (không resolve từ partial).
- Mỗi `existing_issue` không được rule nào xét lại → `unknown` với `REVIEW_REQUIRED`, `SUBJECT_CHANGED` (reviewer cân nhắc dismiss, không tự đóng).

## R01 — đủ 4 nhóm giấy tờ (CL01-P0-v1: registration, loan_request, financial_statement, contract)

| Điều kiện (theo từng loại) | Rule | Assessment `R01:{type}:checklist` |
|---|---|---|
| Có tài liệu `ready`, đã xác nhận loại, có extraction | pass, evidence `[]` | Chỉ khi có existing issue: `candidate_resolved`/`supported`/`DOCUMENT_PROVIDED` |
| Có tài liệu nhưng `failed` / `review_required` / đang xử lý | unknown: `UNREADABLE_SOURCE` / `NEEDS_CLASSIFICATION` / `DOCUMENT_NOT_READY` | Chỉ khi có existing issue: `unknown` + absence_basis. **Không gọi là chưa nộp** |
| Không có tài liệu loại đó | issue | `still_open`/`missing_document`/medium/`MISSING_DOCUMENT` + absence_basis + suggestion loại đó |

Trạng thái rule gộp theo thứ tự issue > unknown > pass.

## R02 — MST người vay (chỉ vai trò người vay, không so bên mua)

Field so sánh: registration/loan_request/financial_statement `borrower.tax_id`; contract/acceptance_record `parties.borrower.tax_id`; payment_record `parties.payee.tax_id`.

| Điều kiện (theo từng tài liệu) | Rule | Assessment `R02:{document_id}:borrower_identity` |
|---|---|---|
| Field `not_present` (ví dụ BCTC không ghi MST) | Bỏ qua | — |
| Field không đọc chắc | unknown `TAX_ID_UNREADABLE` | — |
| Đọc được nhưng sai định dạng 10/10-3 | unknown `TAX_ID_FORMAT_UNRECOGNIZED` | — |
| Khớp `Case.borrower_tax_id` | pass, evidence của field | Có existing issue → `candidate_resolved`/`IDENTITY_CONFIRMED` |
| Khác | issue | `still_open`/`identity_mismatch`/**high**/`BORROWER_TAX_ID_MISMATCH` |
| Existing issue R02 mà tài liệu gốc không còn | unknown | `unknown` + `REVIEW_REQUIRED`, `SUBJECT_CHANGED` |

Tài liệu sai MST **chặn** R08/R09/R10 dựa trên nó: bị coi là `PARTY_MISMATCH`, không bao giờ pass nhờ nguồn sai doanh nghiệp.

## R08 + R10 — điều kiện nghiệm thu của khoản thu (một issue, một assessment)

Key: `R08:{borrower_tax_id}:{contract_ref}:{scope_ref}:acceptance`. Thiếu ref/scope thì dùng `DOC-{loan_request_id}`. R10 **không** tạo issue riêng; dùng `issue_id` của R08 và ghi `rule_ids=["R08","R10"]`.

**Bước 1 — có áp dụng không**

| Điều kiện | R08 |
|---|---|
| Không có đề nghị vay dùng được, hoặc claim_type không thuộc expected/due/received | not_applicable `NO_RECEIPT_CLAIM` |
| Đã có hợp đồng, `payment_condition.event_type = other` | not_applicable `NOT_ACCEPTANCE_CONDITION` (không tạo thiếu nghiệm thu) |
| Không chắc claim_type, ref/scope, ngoại tệ, không tìm thấy hoặc trùng hợp đồng, hợp đồng sai MST người vay, điều kiện null hoặc `unknown` | unknown + assessment `unknown`/`insufficient_evidence` với các mã: `CLAIM_TYPE_UNCLEAR`, `RECEIPT_REF_OR_SCOPE_UNCLEAR`, `UNSUPPORTED_CURRENCY`, `CONTRACT_NOT_FOUND`, `AMBIGUOUS_CONTRACT`, `CONTRACT_BORROWER_NOT_VERIFIED`, `PAYMENT_CONDITION_UNCLEAR`, `RECEIPT_SCOPE_NOT_IN_CONTRACT` |

**Bước 2 — xét từng biên bản nghiệm thu** (mọi `acceptance_record`, kể cả không phải response; ghép bằng ref + bên + scope, **không** bằng tên file)

| Kiểm tra theo thứ tự | Verdict |
|---|---|
| File chưa dùng được (failed, chưa xác nhận loại) | ambiguous `UNREADABLE_SOURCE` |
| Có sai khác xác định: contract_ref, MST người vay, MST bên đối ứng, scope (hoặc tài liệu bị R02 đánh dấu) | mismatch `CONTRACT_/PARTY_/SCOPE_MISMATCH` |
| Thiếu hoặc mơ hồ: ref, MST, scope, tiền, ngày; tiền tệ khác VND | ambiguous `*_UNCLEAR` / `UNSUPPORTED_CURRENCY` |
| Số tiền > giá trị hợp đồng | ambiguous `AMOUNT_EXCEEDS_CONTRACT` |
| Số tiền < giá trị hợp đồng | partial `PARTIAL_ACCEPTANCE` |
| Đủ tiền nhưng `other_conditions_state` ≠ `none` (phụ lục hoặc điều kiện khác chưa giải quyết) | condition_blocked `OTHER_CONDITIONS_UNRESOLVED` |
| Đủ mọi guard | full |

**Bước 3 — assessment theo biên bản tốt nhất** (full > condition_blocked > partial > mismatch > ambiguous; *một file sai không phủ định file đúng*)

| Biên bản tốt nhất | Proposal / category | Reason codes | R08 |
|---|---|---|---|
| full | `candidate_resolved` / `supported`, supported = số tiền, unsupported = `0`, `computed_date` | `ACCEPTANCE_SUPPORTED` | pass |
| condition_blocked | `unknown` / `insufficient_evidence`, không có ngày | `OTHER_CONDITIONS_UNRESOLVED` | unknown |
| partial | `still_open` / `insufficient_evidence`, supported và unsupported là Decimal | `PARTIAL_ACCEPTANCE` | issue |
| mismatch | `still_open` / `mismatched_document` | `SUPPLEMENT_*` (file là response) / `ACCEPTANCE_*` | issue |
| ambiguous | `unknown` / `insufficient_evidence` | các mã mơ hồ | unknown |
| không có biên bản | `still_open` / `missing_document` + absence_basis (acceptance_record) | `MISSING_ACCEPTANCE` | issue |

`computed_date` chỉ tính khi `calendar_days` + có offset + biết cách đếm: `exclude_event_day` → ngày + offset; `include_event_day` → ngày + offset − 1. Trường hợp `business_days`/`unknown` → `null`. Không so với `expected_date` để tạo lỗi.

**R10** (chỉ request `acceptance_record` đã approved, gắn với issue R08)

| Điều kiện | R10 |
|---|---|
| Không có approved request | not_applicable |
| Chỉ có request loại khác | not_applicable `UNSUPPORTED_REQUEST_TYPE` (rule chủ R01/R02/R09 xét) |
| Request gắn issue khác key R08 hiện tại, hoặc R08 không còn áp dụng | unknown `REVIEW_REQUIRED`, `SUBJECT_CHANGED` |
| Có response full và assessment là candidate | pass |
| Chưa có response, hoặc response partial/mismatch | issue (`AWAITING_RESPONSE` khi chưa có response) |
| Response chỉ mơ hồ | unknown |

**Suggestion:** chỉ cho assessment `still_open` khi chưa có approved request cùng `issue_id`. G02 không đề xuất trùng.

## R09 — phát biểu "đã thu"

Key `R09:{tax}:{ref}:{scope}:received`, severity luôn **high**. Không xác thực giao dịch ngân hàng thật.

| Điều kiện | Proposal / category | Reason | R09 |
|---|---|---|---|
| claim_type ≠ received | — | — | not_applicable |
| Khoản thu hoặc hợp đồng không rõ | `unknown` / `insufficient_evidence` | như R08 bước 1 | unknown |
| >1 chứng từ khớp (cần cộng) | `unknown` | `MULTIPLE_PAYMENTS_REQUIRE_SUM` | unknown |
| 1 chứng từ completed khớp ref + payee + payer + VND, số tiền = khai | `candidate_resolved` / `supported` (chỉ khi có existing issue) | `PAYMENT_SUPPORTED` | pass |
| 1 chứng từ khớp, số tiền < khai | `still_open` / `insufficient_evidence`, supported/unsupported | `PARTIAL_PAYMENT` | issue |
| 1 chứng từ khớp, số tiền > khai | `unknown` | `AMOUNT_EXCEEDS_CLAIM` | unknown |
| Chứng từ mơ hồ (pending, ngoại tệ, field không rõ) | `unknown` | `PAYMENT_STATUS_NOT_COMPLETED`, ... | unknown |
| Chứng từ sai ref hoặc bên | `still_open` / `mismatched_document` | `CONTRACT_/PAYEE_/PAYER_MISMATCH` | issue |
| Chỉ có nghiệm thu hoặc hóa đơn | `still_open` / `insufficient_evidence` | `RECEIVED_WITHOUT_PAYMENT_RECORD` | issue |
| Không có gì | `still_open` / `missing_document` + absence_basis | `MISSING_PAYMENT_RECORD` | issue |

## Quyết định cần reviewer (Nguyên) xác nhận

| ID | Quyết định | Lý do |
|---|---|---|
| D-01 | `assessment.id = UUIDv5(namespace, run_id:issue_key)` | Contract chỉ quy định `issue_id`; gold dùng cách tạo khác không ghi trong tài liệu. Protocol không so `assessment.id` |
| D-02 | Thứ tự verdict: full > condition_blocked > partial > mismatch > ambiguous | §2 nêu mismatch > mơ hồ. §11 (A01) yêu cầu điều kiện hợp đồng chưa giải quyết → unknown, kể cả khi còn file sai cũ. Partial đặt trên mismatch vì cùng đối tượng và lượng hóa được |
| D-03 | Mã lỗi input của service nội bộ là `INVALID_REQUEST` (422) | Không có trong catalogue §9.6 |
| D-04 | Evidence của R08 gồm toàn bộ evidence hợp đồng, field khoản thu của đề nghị vay, mọi biên bản ứng viên, và `money.currency` của BCTC | Suy ra từ gold G01–G03 để khớp tập evidence |
