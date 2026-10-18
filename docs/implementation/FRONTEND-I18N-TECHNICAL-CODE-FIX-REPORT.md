# AIC Rating 2.0 — Báo cáo Triển khai Sửa Lỗi Hiển thị Mã Kỹ thuật & Bản địa hóa Frontend

> **Tài liệu bàn giao triển khai:** Khắc phục triệt để hiển thị mã kỹ thuật (`snake_case`, `UPPER_SNAKE_CASE`), lỗi trộn ngôn ngữ Anh-Việt, thanh cuộn tab bar và hoàn thiện hệ thống i18n cho Frontend (`apps/web`).  
> **Phạm vi áp dụng:** AIC Rating 2.0 (`apps/web/src/**`, `apps/web/tests/**`).  
> **Nguyên tắc tuân thủ:** Không sửa Backend (`apps/api`), không sửa AI Service (`services/ai`), không sửa DB/Migrations hay Shared Contracts (`packages/contracts`).

---

## 1. Phân tích Nguyên nhân Gốc rễ (Root Cause Analysis)

Đối chiếu trực tiếp từ ảnh người dùng cung cấp và mã nguồn frontend tại nhánh `duc` (`c:\Users\52duc\Desktop\Fintech`):

### 1.1. Lỗi hiển thị mã kỹ thuật `COUNTERPARTY_IDENTITY_SOURCE · MISSING_DOCUMENT`, `warning`, `info`
- **Vị trí phát sinh:** `apps/web/src/features/review/components/document-review.tsx` dòng 103–108:
  ```tsx
  <p className="eyebrow">{f.rule_id} · {f.category}</p>
  ...
  <Status value={f.severity} />
  ```
- **Cơ chế lỗi:**
  - Component `Status` (`apps/web/src/components/ui/status.tsx` dòng 11) kiểm tra `value in messages ? t(value as MessageKey) : value.replaceAll('_', ' ')`.
  - Các giá trị `severity` (`warning`, `info`, `blocker`) và `category` (`missing_document`, `financial_minimum`, `identity_uncertainty`, `source_uncertainty`, `identity_conflict`, `transaction_uncertainty`, `contradiction`) **hoàn toàn vắng mặt** trong từ điển `apps/web/src/lib/i18n/messages.ts`.
  - Hậu quả: Hệ thống fallback sang `replaceAll('_', ' ')`, in thẳng `"warning"`, `"info"` bằng tiếng Anh và in nguyên xi `counterparty_identity_source · missing_document` ở tiêu đề phụ (eyebrow).

### 1.2. Lỗi hiển thị câu tiếng Anh xen giữa giao diện tiếng Việt
- **Vị trí phát sinh:**
  - `document-review.tsx` dòng 106: `<h3>{f.summary}</h3>` in chuỗi tiếng Anh tĩnh từ backend: `Missing documentary support: counterparty_identity_source`.
  - `document-review.tsx` dòng 114: `{f.absence_basis && <p>{f.absence_basis}</p>}` in chuỗi tiếng Anh: `No current document has matching specialist-reviewed scope and a policy-listed supporting type.`.
  - `document-review.tsx` dòng 118–122: `{f.limitations.map(text => <p>{text}</p>)}` in các câu hạn chế tiếng Anh: `Absence of a document does not establish absence of the underlying fact.`, `Numeric FHI blocked...`.
  - `document-review.tsx` dòng 73–77: `detail.transaction_review.limitations` in: `No verified settlement or outstanding balance is computed.`, `Human verification remains required.`.
  - `workspace.tsx` dòng 188–193 & `risk-assessment.tsx` dòng 84–93: `currentReadiness.blockers` (`Separate financial method approval is required.`) và `currentReadiness.limitations` (`Document review does not verify facts or approve a transaction.`) in chuỗi tiếng Anh trực tiếp mà không qua mapper.
  - `waivable_requirements` (dòng 176, 190, 229 trong `document-review.tsx` và dòng 96 trong `risk-assessment.tsx`) in trực tiếp `item.label ?? item.requirement_key`. Backend gán `label: p.requirement_key`, dẫn tới in mã kỹ thuật `counterparty_identity_source` ra màn hình.

### 1.3. Lỗi thanh cuộn ngang ở cuối hàng tab (Tab Bar Overflow Glitch)
- **Vị trí phát sinh:** `apps/web/src/styles/base.css` dòng 474 & 1772, `apps/web/src/styles/workspace.css` dòng 267.
- **Cơ chế lỗi:** Thuộc tính `scrollbar-width: thin` kết hợp với `overflow-x: auto` trên container flex `.workspace-tabs` kích hoạt thanh cuộn ngang mặc định của trình duyệt Chromium/Windows ngay cả khi nội dung chỉ chớm chạm biên viền hoặc làm tròn subpixel, tạo cảm giác đứt gãy UI ở cuối thanh tab.

---

## 2. Danh sách File Đã Sửa và Phân loại Thay đổi

| STT | Đường dẫn File | Phân loại | Mục đích & Chi tiết Thay đổi |
|:---:|---|:---:|---|
| 1 | `apps/web/src/lib/i18n/messages.ts` | **Core Catalog** | Bổ sung 28+ message keys bao gồm: severities (`warning`, `info`, `blocker`), categories (`missing_document`, `financial_minimum`, `identity_uncertainty`, v.v.), rule IDs, trạng thái (`CLEAR`, `pending`, `uncertain`, `rule_based`, `human_marked_missing`), và chrome UI (`technicalDetails`, `ruleId`, `category`, `severity`). |
| 2 | `apps/web/src/lib/i18n/review-i18n.ts` | **New Helper Module** | Module chuyên trách chuẩn hóa bản địa hóa thẩm định rủi ro: `localizeRuleId`, `localizeCategory`, `localizeSeverity`, `localizeFindingSummary`, `localizeAbsenceBasis`, `localizeLimitation`, `localizeBlocker`, `localizeRequirementKey`, `localizeConditionKind`, `localizeClaimState`, `localizeClaimKind`. Hỗ trợ toàn diện 3 ngôn ngữ (`en`, `vi`, `zh-CN`), type-safe, không vi phạm boundary architecture. |
| 3 | `apps/web/src/components/ui/status.tsx` | **UI Component** | Mở rộng bảng ánh xạ màu sắc `resolveTone`: `green` cho `CLEAR_FOR_REVIEW`, `CLEAR`; `red` cho `blocker`, `BLOCKED`, `critical`; `amber` cho `warning`, `FOLLOW_UP`. Tra cứu từ điển `messages` trước khi fallback. |
| 4 | `apps/web/src/features/review/components/document-review.tsx` | **Feature Component** | Áp dụng localization cho: `localizeRuleId`, `localizeCategory`, `localizeFindingSummary`, `localizeAbsenceBasis`, `localizeLimitation`, `localizeRequirementKey`. Bổ sung disclosure box `<details className="aic-technical-details">` để chuyên viên có thể xem `rule_id`, `category` và UUID khi cần kiểm tra audit mà không làm xấu UI chính. |
| 5 | `apps/web/src/features/review/components/issue-decision.tsx` | **Feature Component** | Sử dụng `localizeFindingSummary` cho modal giải quyết/bác bỏ phát hiện thay vì hiển thị tóm tắt tiếng Anh. |
| 6 | `apps/web/src/features/requests/components/request-draft.tsx` | **Feature Component** | Sử dụng `localizeFindingSummary` trong danh sách dropdown chọn phát hiện cần yêu cầu tài liệu bổ sung. |
| 7 | `apps/web/src/features/cases/components/workspace.tsx` | **Feature Component** | Bản địa hóa `currentReadiness.blockers` (`localizeBlocker`) và `currentReadiness.limitations` (`localizeLimitation`). |
| 8 | `apps/web/src/features/assessments/components/risk-assessment.tsx` | **Feature Component** | Bản địa hóa `readiness.blockers`, `readiness.limitations`, `waivable_requirements`, `transaction_review.findings`, `transaction_review.limitations` và `result.limitations`. |
| 9 | `apps/web/src/features/assessments/components/factor-detail.tsx` | **Feature Component** | Bản địa hóa `factor.limitations` qua `localizeLimitation`. |
| 10 | `apps/web/src/features/documents/components/extraction-review.tsx` | **Feature Component** | Bản địa hóa `missing_reason` khi trường trích xuất bị thiếu. |
| 11 | `apps/web/src/styles/base.css` | **CSS Styling** | Khắc phục thanh cuộn ngang tab bar: `scrollbar-width: none; -ms-overflow-style: none; ::-webkit-scrollbar { display: none; }`. Thêm định dạng tinh tế cho `.aic-technical-details`. |
| 12 | `apps/web/src/styles/workspace.css` | **CSS Styling** | Ẩn thanh cuộn thừa trên `.aic-production .workspace-tabs`. |
| 13 | `apps/web/tests/unit/review-i18n.test.cjs` | **Test Suite** | Bộ kiểm thử tự động gồm 7 test cases lớn xác thực toàn bộ rule IDs, categories, severities, summaries, limitations, blockers, edge cases và tái hiện đúng fixture từ screenshot người dùng. |

---

## 3. Bảng Mẫu Ánh Xạ Nghiệp vụ (24 Trường hợp Thực tế)

| Mã kỹ thuật / Chuỗi Backend | Tiếng Việt (`vi`) | Tiếng Anh (`en`) | Tiếng Trung (`zh-CN`) | Ý nghĩa Nghiệp vụ & Thẩm định |
|---|---|---|---|---|
| `counterparty_identity_source` | Chứng từ xác minh danh tính/pháp nhân đối tác | Counterparty identity document | 交易对手身份证明材料 | Chứng từ căn cứ (ĐKKD/giấy phép) xác minh sự tồn tại pháp lý của đối tác. |
| `financial_minimum` | Bộ dữ liệu tài chính tối thiểu | Minimum financial dataset | 最低财务数据集 | Báo cáo tài chính đáp ứng tiêu chuẩn tối thiểu để tính toán FHI. |
| `transaction_contract` | Hợp đồng giao dịch | Transaction contract | 交易合同 | Văn bản pháp lý làm căn cứ phát sinh nghĩa vụ nợ hoặc quyền thu. |
| `delivery_acceptance_source` | Chứng từ giao hàng / nghiệm thu | Delivery / acceptance record | 交付 / 验收凭证 | Căn cứ chứng minh nghĩa vụ giao dịch đã được thực hiện thực tế. |
| `paid_received_source` | Chứng từ thanh toán / nhận tiền | Payment / receipt record | 收付款凭证 | Căn cứ xác nhận dòng tiền đã thực chi hoặc thực nhận. |
| `refund_guarantee_source` | Chứng từ hoàn tiền / bảo lãnh | Refund / guarantee document | 退款 / 担保文件 | Tài liệu bảo đảm hoàn ứng hoặc bảo lãnh thực hiện hợp đồng. |
| `supplementary_tax_invoice` | Hóa đơn / báo cáo thuế bổ sung | Supplementary tax invoice / report | 补充税务发票 / 报告 | Tài liệu thuế bổ trợ đối chiếu giao dịch, không thay thế chứng từ thanh toán. |
| `missing_document` | Thiếu chứng từ | Missing document | 缺失文件 | Phân loại phát hiện: hồ sơ thiếu chứng từ hỗ trợ theo quy định chính sách. |
| `identity_uncertainty` | Chưa đủ căn cứ xác minh danh tính | Identity uncertainty | 身份依据不足 | Phân loại phát hiện: dữ liệu đối tác chưa đủ độ tin cậy để chốt pháp nhân. |
| `source_uncertainty` | Nguồn tài liệu chưa xác thực | Source uncertainty | 材料来源存疑 | Phân loại phát hiện: tài liệu mới khai báo hoặc trích xuất AI chưa kiểm chứng. |
| `identity_conflict` | Xung đột danh tính đối tác | Counterparty identity conflict | 交易对手身份信息冲突 | Phân loại phát hiện: mâu thuẫn giữa thông tin khai báo và tài liệu nguồn. |
| `warning` | Cảnh báo | Warning | 警告 | Mức độ cảnh báo: cần kiểm tra, không tự động chặn toàn bộ luồng. |
| `info` | Thông tin | Information | 信息 | Mức độ thông tin: giải thích giới hạn thẩm định, không trừ điểm. |
| `blocker` | Yếu tố chặn | Blocker | 阻碍项 | Yếu tố chặn: cấm phê duyệt hoặc cấm tính điểm FHI khi chưa giải tỏa. |
| `Missing documentary support: counterparty_identity_source` | Chưa có chứng từ phù hợp để xác minh danh tính đối tác | Missing documentary support: Counterparty identity | 缺少用于确认交易对手身份的支持文件 | Thông báo phát hiện thiếu đăng ký kinh doanh hợp lệ. |
| `No current document has matching specialist-reviewed scope and a policy-listed supporting type.` | Hiện chưa có tài liệu nào thuộc phạm vi đã được chuyên viên rà soát và đúng loại chứng từ theo chính sách. | No current document has matching specialist-reviewed scope and a policy-listed supporting type. | 当前暂无符合专员已复核范围且符合政策所列支持类型的文件。 | Căn cứ kết luận thiếu chứng từ: tài liệu hiện tại không khớp phạm vi/loại. |
| `Absence of a document does not establish absence of the underlying fact.` | Việc thiếu chứng từ không đồng nghĩa với việc giao dịch hoặc dữ kiện thực tế không tồn tại. | Absence of a document does not establish absence of the underlying fact. | 缺少文件并不等同于底层事实不存在。 | Nguyên tắc thẩm định: thiếu hồ sơ là hạn chế bằng chứng, không quy chụp giao dịch là giả. |
| `Numeric FHI blocked; document review, supported ratios and Transaction Review remain available independently. Method approval is a separate gate.` | Chỉ số tài chính FHI bị tạm khóa; rà soát hồ sơ, các chỉ số có chứng từ và Rà soát giao dịch vẫn hoạt động độc lập. Phê duyệt phương pháp là cổng kiểm soát riêng. | Numeric FHI blocked; document review, supported ratios and Transaction Review remain available independently. Method approval is a separate gate. | 数值型 FHI 已被阻止；文件审查、有支持的比率及交易审查仍可独立进行。方法审批为独立门禁。 | Cảnh báo FHI: thiếu tài chính sẽ khóa điểm số, nhưng các rà soát khác vẫn chạy độc lập. |
| `Document classification, identity, dates, amounts and signatures remain subject to human verification.` | Phân loại tài liệu, danh tính, ngày tháng, số tiền và chữ ký vẫn phải qua bước xác minh của con người. | Document classification, identity, dates, amounts and signatures remain subject to human verification. | 文件分类、主体身份、日期、金额和签署仍须经人工核实。 | Hạn chế trích xuất: AI chỉ hỗ trợ trích xuất, chuyên viên phải xác nhận giá trị. |
| `Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.` | Dữ liệu trích xuất bị mờ, thiếu, lỗi hoặc chưa chắc chắn không được tự động thay thế bằng dữ kiện đã xác nhận. | Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact. | 不可读、缺失、失败或存疑的提取数据不会被隐式替换为已确认的事实。 | Nguyên tắc an toàn dữ liệu: không tự ý giả định dữ liệu khi AI không đọc được. |
| `No verified settlement or outstanding balance is computed.` | Chưa có số liệu thanh toán hoặc số dư công nợ được tính toán có xác minh. | No verified settlement or outstanding balance is computed. | 尚未计算出经核实的结算金额或未结余额。 | Giới hạn rà soát giao dịch: chưa xác minh thì không tự suy diễn số dư nợ. |
| `Human verification remains required.` | Vẫn bắt buộc phải có sự xác minh của chuyên viên. | Human verification remains required. | 仍需人工专员进行核实。 | Yêu cầu kiểm soát: mọi nhận định phải do chuyên viên chịu trách nhiệm. |
| `FHI_METHOD_UNCONFIGURED` | Cần có phê duyệt phương pháp tài chính riêng biệt. | Separate financial method approval is required. | 需要单独的财务方法审批。 | Yếu tố chặn readiness: mô hình FHI chưa được phê duyệt kích hoạt cho case này. |
| `Document review does not verify facts or approve a transaction.` | Rà soát hồ sơ không xác minh thay cho dữ kiện thực tế và không cấu thành phê duyệt giao dịch. | Document review does not verify facts or approve a transaction. | 文件审查不代表核实事实或批准交易。 | Tuyên bố miễn trách: việc chạy rà soát tài liệu không đồng nghĩa với giải ngân/chấp thuận. |

---

## 4. Danh mục Strings Cố ý KHÔNG Dịch (Verbatim / Non-Localizable)

Theo đúng nguyên tắc kiến trúc số 4 của đặc tả kỹ thuật, các dữ liệu sau **bắt buộc giữ nguyên giá trị gốc**, không can thiệp dịch thuật:
1. **Trích dẫn nguyên văn bằng chứng (`evidence_ref`, `quote`):** Trích đoạn văn bản hợp đồng, điều khoản thanh toán, biên bản bàn giao giữ nguyên ngôn ngữ gốc của chứng từ.
2. **Dữ liệu định danh thực thể:**
   - Tên pháp nhân đối tác: ví dụ `"Công ty Cổ phần ..."` hoặc `"Acme International Ltd."`.
   - Mã số thuế / Mã định danh doanh nghiệp: ví dụ `"0101234567"`.
   - Địa chỉ trụ sở, tên người đại diện pháp luật, số tài khoản ngân hàng.
3. **Mã định danh kỹ thuật & Audit Artifacts:**
   - Phiên bản quy tắc kiểm toán: `AIC-MVP-DOCUMENT-TRANSACTION-1`.
   - Phiên bản chính sách & Hash: `AIC-MVP-SANDBOX-2026-10-17.1`, mã SHA-256 (`a44ddb99...`).
   - UUIDs: Case ID (`5e9fc0de-...`), Document ID, Finding ID, Request ID. (Các ID này được gom gọn trong mục disclosure `Chi tiết kỹ thuật`).
4. **Giá trị số học & Tiền tệ:** Số tiền giao dịch (định dạng theo locale với đơn vị VND, không thay đổi số học), số ngày thời hạn (`term_days`), số trang (`pages`).
5. **Nội dung người dùng nhập:** Lý do bác bỏ/khắc phục do chuyên viên gõ (`reason`), nội dung yêu cầu bổ sung chứng từ (`purpose`, `content`).

---

## 5. Báo cáo Kết quả Kiểm thử Tự động (Verification & Test Report)

### 5.1. Các lệnh kiểm thử đã thực thi

```powershell
# 1. Kiểm tra ranh giới kiến trúc và kiểm thử đơn vị frontend
pnpm --filter @fintech/web check:aic

# 2. Kiểm tra typecheck TypeScript toàn bộ frontend
pnpm --filter @fintech/web typecheck

# 3. Chạy production build Next.js với Turbopack
pnpm --filter @fintech/web build
```

### 5.2. Kết quả kiểm thử

| Nhóm Kiểm thử | Tổng số Test | PASS | FAIL | SKIP | Ghi chú |
|---|:---:|:---:|:---:|:---:|---|
| **Architecture Boundaries** | 101 files, 11 modules | **PASS** | 0 | 0 | Không chu trình, không orphan module, tuân thủ nghiêm ngặt quy tắc module. |
| **Frontend Unit Tests** | 41 tests | **41** | 0 | 0 | Bao gồm 7 test suites mới kiểm tra toàn diện `review-i18n` và regression case từ ảnh. |
| **API Integration Checks** | 18 checks | **18** | 0 | 0 | Bảo toàn contract, CSRF, Idempotency, Money precision, Session expiry. |
| **TypeScript Typecheck** | Next typegen + tsc | **PASS** | 0 | 0 | 0 lỗi kiểu dữ liệu. |
| **Next.js Production Build** | 10 routes | **PASS** | 0 | 0 | Build thành công với Turbopack trong 1.18s, xuất khẩu static & dynamic routes hoàn hảo. |
| **Browser Visual Verification** | N/A | — | — | — | Đánh dấu `BROWSER_NOT_RUN` (môi trường CI/Terminal headless không có màn hình hiển thị trực tiếp). |

---

## 6. Lỗ hổng Hợp đồng Backend Cần Đề xuất Cải tiến (`BACKEND_CONTRACT_GAP`)

Hiện tại, Frontend đã khắc phục triệt để bằng cấu trúc từ điển mẫu và bộ phân tích ngữ cảnh type-safe (`review-i18n.ts`). Tuy nhiên, để đảm bảo tính mở rộng dài hạn (lỡ Backend bổ sung các quy tắc mới ngoài Sandbox MVP), xin ghi nhận các khuyến nghị kiến trúc sau cho Owner:

1. **`BACKEND_CONTRACT_GAP_01` (Structured Message Keys for Findings):**
   - *Hiện trạng:* Backend `MvpWorkflowService` đang tạo tóm tắt finding bằng cách ghép chuỗi tiếng Anh: `` `Missing documentary support: ${row.requirement_key}` `` và trả về chuỗi `absence_basis` dạng free-text tiếng Anh.
   - *Đề xuất chuẩn hóa:* Trong phiên bản API tiếp theo, Backend nên bổ sung trường chuẩn:
     ```json
     {
       "message_key": "FINDING_MISSING_DOCUMENTARY_SUPPORT",
       "message_params": {
         "requirement_key": "counterparty_identity_source"
       }
     }
     ```
2. **`BACKEND_CONTRACT_GAP_02` (Readiness Blocker Structured Codes):**
   - *Hiện trạng:* `Readiness.blockers` hiện đã có `code` (`FHI_METHOD_UNCONFIGURED`), nhưng message vẫn đi kèm chuỗi tiếng Anh hardcoded.
   - *Khuyến nghị:* Duy trì `code` ổn định và để Frontend hoàn toàn chịu trách nhiệm render thông điệp theo locale từ `code`.
