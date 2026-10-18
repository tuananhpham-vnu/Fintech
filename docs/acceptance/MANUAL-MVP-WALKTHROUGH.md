# Kịch bản test tay MVP — hai hồ sơ mẫu

Đối chiếu UI/source hiện tại ngày17/10/2026. Đây là hướng dẫn thực hiện, **không phải kết quả đã chạy**. Chọn ngôn ngữ English để dễ tìm các nhãn dưới đây. Dùng dữ liệu giả và sandbox riêng.

## 0. Chuẩn bị: có môi trường chạy trước khi bấm thử

Database tạm của lượt retest Gemini đã dừng. Tài khoản và hai case của lượt đó không phải tài khoản/demo đang chạy để đăng nhập. Có file `.env` không đồng nghĩa DB đã migrate, có user/policy, worker đang chạy hoặc các process đã nhận cấu hình.

Nếu chưa có sandbox dùng tay, thực hiện phần **Prerequisites and database boundary** và **Ordinary local launch commands** trong `docs/implementation/MVP-SANDBOX-README.md`: tạo DB mới, owner/API/worker roles riêng, migrate0001–0017, apply grants, bootstrap organization/specialist/policy assignments và tạo private cache. Chọn username/password của chính sandbox này; không có credential mặc định. Không migrate/reset DB đang dùng cho việc khác.

Sau khi cấu hình đúng các biến trong từng terminal, tại `C:\Users\52duc\Desktop\Fintech`:

```powershell
pnpm api:build
```

Giữ bốn terminal chạy riêng:

| Terminal | Lệnh | Điều kiện cấu hình |
| --- | --- | --- |
| API | `node apps/api/dist/main.js` | DATABASE_URL của API role; development/foundation; document runtime local/live; private storage; frontend origin127.0.0.1:3000; port3001 |
| AI | Từ `services/ai`: `../../.venv/Scripts/python.exe -m runner serve --port 8100` | AI_MODE=live; MODEL_ID=gemini-3.1-flash-lite; key server; private storage và internal key khớp API/worker |
| Worker | `node apps/api/dist/documents/run-worker.js --poll` | DATABASE_URL của worker role; cùng local/live/storage/AI URL/internal key |
| Frontend | `pnpm dev --hostname 127.0.0.1 --port 3000` | AIC_BACKEND_URL=http://127.0.0.1:3001/api/v2 |

Đây là các lệnh khởi động **sau setup**, không phải script tự tạo sandbox/nạp đủ config. Nest đọc process environment; đừng mặc định chỉ sửa root `.env` là mọi terminal nhận được. AI có nạp root `.env`, nhưng biến đã có trong process ưu tiên hơn. Restart AI sau khi đổi model.

Mở `http://127.0.0.1:3000`. Dùng thống nhất `127.0.0.1`, tránh đổi sang `localhost` giữa chừng. `http://127.0.0.1:8100/healthz` báo live chỉ chứng minh service chạy; phải hoàn thành upload/extraction mới chứng minh provider hoạt động.

Chuẩn bị thư mục ghi kết quả ngoài source: mỗi bước ghi PASS/FAIL/BLOCKED, thời gian, case ID, ảnh đã che thông tin nhạy cảm. Không lưu password, cookie, token invitation, key hay nguyên HAR.

## 1. Bộ dữ liệu dùng xuyên suốt

| Trường | Hồ sơ A | Hồ sơ B |
| --- | --- | --- |
| Counterparty | Buyer Alpha có sẵn từ bootstrap | Supplier Beta có sẵn từ bootstrap |
| Transaction type | RECEIVABLE | PREPAYMENT |
| Organization role | seller | buyer |
| Counterparty role | buyer | seller |
| Stage | proposed | proposed |
| Amount (VND) | 500000000 | 200000000 |
| Term (calendar days) | 60 | 30 |
| Contract reference | MANUAL-REC-001 | MANUAL-PRE-001 |
| Contract PDF | `packages/contracts/fixtures/04_contract.pdf` | Cùng file này |
| Source class | synthetic_manual_test | synthetic_manual_test |

PDF trên là dữ liệu tổng hợp và không mặc nhiên chứng minh đúng pháp nhân của hai counterparties. Chỉ đánh dấu source subject `match` khi thực sự đọc và đối chiếu khớp; khác chủ thể thì chọn mismatch, chưa rõ thì unresolved. Muốn test happy path xác nhận nguồn, phải dùng bộ tài liệu giả có identity nhất quán với counterparty.

## 2. Login và counterparties

1. Nhập username giả `manual-user-does-not-exist`, password sai, đăng nhập **một lần**. Mong đợi lỗi chung, không vào workspace, không tiết lộ tài khoản tồn tại. Không thử sai liên tục làm chạm login throttle.
2. Đăng nhập bằng specialist do bạn bootstrap. Mong đợi vào Cases, không phải tài khoản prototype.
3. Vào Counterparties → **Add counterparty**. Nhập:
   - Legal name: `MANUAL_RAW_Company_001`; Country: `VN`; Tax / registration ID: `SYN-MANUAL-001`; Industry code: `4690`.
   - Declaration reference: `DECL-MANUAL-001`.
   - Reported information: `Thông tin giả do chuyên viên nhập; chưa xác nhận pháp nhân`.
   - Reason for saving: `Tạo đối tác tổng hợp để test tay`.
4. Save; tìm lại đối tác vừa tạo. Mong đợi identity vẫn unresolved, ID chuỗi không bị tự sửa.
5. Edit → sửa declaration/reason → Save → F5. Mong đợi nội dung còn nguyên, identity không tự verified. Hai hồ sơ chính vẫn dùng Buyer Alpha/Supplier Beta để dễ theo dõi.

## 3. Tạo hồ sơ RECEIVABLE và kiểm tra Exposure

6. Cases → **New transaction**. Chọn Buyer Alpha và điền hồ sơ A trong bảng. Create; lưu URL/case ID. Kiểm tra seller/buyer đúng, stage vẫn proposed.
7. Mở Edit Exposure. Chọn Unknown cho amount, để reason trống → Save. Mong đợi không lưu. Thử reason chỉ có khoảng trắng cũng không được lưu.
8. Điền amount reason `Chưa nhận được báo giá`; chọn Unknown cho term, để reason chưa chọn → Save. Mong đợi không lưu.
9. Chọn term reason `source_missing` → Save → F5 → mở Edit lại. Mong đợi amount/term unknown với reason đúng, không thành0; kind/roles/stage không đổi.
10. Bỏ Unknown, khôi phục500000000 và60 ngày để tiếp tục happy path. Không đổi stage tự động.
11. **Add claim** → paid → actual. Để amount/date chưa biết và nhập reason cho từng phần; obligation reference `MANUAL-PAY-001`. Chọn nguồn declaration/lời khai, nhập nội dung và thông tin người khai theo form → Save.
12. Mong đợi payer=counterparty, payee=organization; lời khai được lưu dù không có chứng từ, verification vẫn unverified. Actual không thành verified payment; không được tự xác nhận đã thu tiền/dư nợ. Unknown date không thành quá hạn.
13. Nếu thêm condition, chỉ chọn loại thực sự có trong form; ví dụ điều kiện giao hàng/acceptance cần nguồn tương ứng. Không có chứng cứ thì giữ unknown/unverified, không đánh dấu hoàn thành để làm đẹp review.

## 4. Document → AI → nguồn → human correction

14. Documents → **Upload PDF**. Mode=new, type=contract, Source class=`synthetic_manual_test`, chọn `C:\Users\52duc\Desktop\Fintech\packages\contracts\fixtures\04_contract.pdf` → Upload PDF **một lần**.
15. Chờ job queued/running rồi completed. Nếu failed: ghi error code/request ID và dừng bước phụ thuộc; không upload lại liên tục hoặc gọi failed là PASS. Worker không chạy sẽ khiến job không tiến triển.
16. **View source**: PDF phải render thật, có version/hash/page. Zoom125%; đối chiếu chữ với PDF gốc. Hash file có thể lấy trong PowerShell:

```powershell
Get-FileHash C:\Users\52duc\Desktop\Fintech\packages\contracts\fixtures\04_contract.pdf -Algorithm SHA256
```

17. Hash phải khớp viewer. **Review extracted fields**: mở ít nhất một field có giá trị/evidence; đối chiếu quote và trang thật. Thiếu căn cứ phải giữ unknown/uncertain, không yêu cầu AI bịa đủ field.
18. Chọn một field có căn cứ → **Correct a field** → chọn tùy chọn để effective value thành unknown/null → reason `Test bỏ sử dụng giá trị nhưng giữ nguyên nguồn AI` → Save. Mong đợi effective thay đổi, raw value/source vẫn giữ; F5 vẫn vậy.
19. Mở **Classify** nếu có, chọn type/page/reason và subject match theo nội dung thật. Mismatch/unresolved phải giữ limitation. Classification không xác nhận mọi claim hoặc identity.
20. Upload mode=replace, chọn document gốc và một PDF tổng hợp phù hợp. Mong đợi version mới; lịch sử/source version cũ còn đọc được, không bị ghi đè. Kết quả phụ thuộc nguồn cũ phải stale/đòi review lại. Thực hiện bước này sau khi đã ghi lại bằng chứng nguồn cũ.

## 5. Review, yêu cầu bổ sung, waiver và issue history

21. Review → **Run Review**. Mong đợi có kết quả Transaction Review dù chưa có FHI; thiếu identity/financial/source có findings cụ thể. Score/band/grade/PD vẫn null hoặc chưa khả dụng.
22. History → **Request supplement**. Chọn finding hiện tại về identity source, document type registration; Purpose=`Bổ sung đăng ký doanh nghiệp giả lập`; Content=`Cung cấp nguồn đúng pháp nhân, không gửi hồ sơ thật` → Save.
23. Request phải ở draft. **Approve request** → reason → Save → **Download approved text**. Giữ file đã tải và SHA256 bằng `Get-FileHash`. Tải lại cùng bản approved: bytes/hash không đổi.
24. Upload mode=response, chọn đúng approved request. Thử type=contract trong khi request đòi registration: mong đợi từ chối/conflict, không gắn nhầm response.
25. Chọn type=registration, file tổng hợp phù hợp. Có thể dùng `apps/web/tests/fixtures/pdf/registration.pdf` để thử nhận/đọc file; **không mặc định file này khớp Buyer Alpha**. Classify subject theo đối chiếu thực tế, rồi chạy lại review/recheck và ghi nhận supplement review nếu form cho phép.
26. Wrong-subject/thiếu căn cứ phải còn blocker. Correct source chỉ xử lý finding liên quan, không xóa tất cả findings hay xác nhận payment. Nếu chưa có fixture khớp để chứng minh nhánh thành công, ghi BLOCKED cho nhánh đó.
27. Với requirement được liệt kê **Waive**, thử reason trống → không lưu; nhập `Tiếp tục review với limitation do thiếu identity source` → Save. Finding/limitation vẫn còn, identity không thành verified. **Revoke** → reason → Save → review lại; waiver hết hiệu lực, lịch sử còn. Financial minimum không được waive thành đủ điều kiện phát điểm.
28. Khi issue history có hành động Resolve/Dismiss/Reopen, thử theo trạng thái UI cho phép. Resolve chỉ thành công khi có nguồn reviewed/evidence hiện tại đúng lineage và đầy đủ điều kiện; thiếu nguồn phải fail closed. Dismiss không xóa raw finding/detector gate; Reopen phải để lại lịch sử. Không có eligible issue thì ghi BLOCKED/NOT RUN, không thay dữ liệu để ép nút hoạt động.

## 6. Questionnaire: staff entry và người trả lời riêng

29. Information → **Questionnaire**. Content=`Theo lời khai, thời hạn thanh toán dự kiến là bao nhiêu ngày?`; reason=`Câu hỏi text bổ sung optional cho test tay` → Save.
30. Staff entry: khai reporting party/contact đúng vai trò; answer=`45 ngày theo lời khai, chưa có chứng từ`; reason theo form → Save. Mong đợi staff_transcribed/unverified, không phải SME_direct. Thử skip với reason trống rồi reason có nội dung; chỉ lần đủ reason được lưu.
31. **Create scoped invitation** → chọn câu hỏi, reporting party, recipient reference `MANUAL-CFO-001`, reason → Create. Copy link **trước khi đóng**; không gửi link/token vào chat/log/ảnh.
32. Mở cửa sổ ẩn danh riêng, không có cookie specialist → dán link → khai tên/contact tổng hợp → trả lời `45 ngày theo lời khai` → **Review before submitting** → **Submit responses**.
33. Mong đợi receipt; specialist refresh thấy đúng raw response và provenance người tự trả lời; token không chứng minh identity. Thử submit lại: không sinh hai bản trả lời độc lập ngoài semantics đã khóa.
34. Specialist **Revoke** invitation với reason. Mở lại original link ở context mới: không được tiếp tục trả lời. Tạo invitation mới cho cùng scope để test reissue: link cũ bị revoke; dùng link mới. Đóng invitation nếu UI có action; link closed phải bị chặn.
35. Nếu có nguồn reviewed đúng case để verify response, thực hiện separate verification với reason/evidence. Sửa response bằng staff correction: revision mới, verification cũ reset/stale, lịch sử giữ lại. Không có nguồn thích hợp thì ghi BLOCKED cho positive verification.
36. Invitation expiry: chỉ kết luận sau khi thực sự qua TTL đang cấu hình, không chỉ sửa đồng hồ browser. Đường dẫn bị sai/token sửa một ký tự phải fail. Không chia sẻ token hợp lệ để chứng minh ca này.

## 7. Financial registry và stale

37. Assessment → financial registry → **Create**. Bộ1: Start2025-01-01, End2025-12-31; kỳ FY; accounting regime VN_TT133; currency VND; unit1 nếu form yêu cầu; Source statement version=`MANUAL-FS-2025-v1`. Chọn basis/audit status đúng nguồn giả, không tự gán audited.
38. Manual entry provenance/source statement=`Nguồn tổng hợp do chuyên viên nhập: current assets 1000.25 VND; chưa xác minh BCTC`. Trong current_assets, Original label=`MANUAL_current_assets`; Raw decimal=`1000.25`; reason=`Test dữ liệu tài chính có provenance` → Save. Các facts khác để trống, không zero-fill.
39. Mong đợi raw1000.25 → normalized1000.25 khi unit1/VND; verification ban đầu unverified. Thiếu dữ liệu cho ratio phải báo thiếu, không tự suy ra mẫu số hoặc đủ7 chỉ tiêu.
40. Tạo bộ2 cho FY2024 với source version khác. Khi có nhiều sets, phải chọn rõ một set để xem ratios; không tự trộn hai năm.
41. Chọn set2025 → **Review verification** của fact; đối chiếu đúng manual source, chọn fact và status verified + reason. Đây chỉ xác nhận dữ liệu khớp lời khai manual đang xem, không chứng nhận BCTC kiểm toán/identity. Nếu nguồn không đủ để ra quyết định thì giữ unverified.
42. Sửa contract reference trong Exposure → Save → quay lại Assessment: snapshot/result phụ thuộc phải stale. Sửa manual source/fact: revision mới và verification cần review lại; giá trị/lịch sử trước không bị xóa.
43. Mọi bước trên vẫn phải giữ score/band/grade/PD/points null. Không có điểm số là hành vi đúng khi method chưa phê duyệt.

## 8. Chạy lại cho PREPAYMENT và kiểm tra cuối

44. Tạo hồ sơ B theo bảng; lặp lại các phần3–7. Lúc tạo claim paid: payer phải là organization, payee là counterparty. Không được suy ra giao hàng, nghiệm thu, hoàn tiền hay guarantee từ lời khai đã trả tiền.
45. Revision conflict: mở cùng case bằng hai cửa sổ specialist A/B; cả hai mở Edit trước. A sửa reference thành `MANUAL-WINNER`, Save. B giữ draft cũ, sửa thành `MANUAL-STALE`, Save. Mong đợi409/conflict, không ghi đè A. B phải giữ draft, đọc bản mới/rebase rồi **chủ động** resubmit; không tự retry bằng key mới.
46. Bỏ một draft chưa lưu, chuyển case hoặc logout/relogin: draft không lọt sang case khác hoặc tự xuất hiện lại sau khi đã bỏ. Logout xong, Back/F5 không đọc được dữ liệu protected; login lại bằng account hợp lệ.
47. Ngôn ngữ: en/vi/zh-CN; desktop và mobile khoảng390px. Nhãn UI đổi, tên công ty/raw quote/money/source không bị dịch/sửa. Không vỡ layout chính. Tab/Arrow/Home/End cho tabs; Escape đóng clean dialog; focus về nút mở. Draft có thay đổi có thể có xác nhận bỏ, không ép Escape mất dữ liệu.
48. Persistence: khi worker không còn job running, dừng đúng API/worker của sandbox và khởi động lại với **cùng DB/storage**. F5: case IDs/revisions, PDF cũ, source hash, corrections, declarations và approved export còn nguyên. Không chạy lại bootstrap hoặc launcher disposable để kiểm persistence.
49. Failed AI/retry là ca riêng có thể gây gián đoạn: chỉ ở sandbox riêng, khi không có job khác, dừng AI rồi upload một synthetic document; ghi failed/provider-unavailable. Khởi động lại AI, chỉ dùng **Try again** nếu job thực sự eligible và UI cho phép; reason/revision/current exact source, cùng job/document binding, không re-upload để che lỗi. Automatic retry có thể làm khó giữ failed state; không tự thay giới hạn chỉ để đạt PASS. Không eligible thì ghi BLOCKED.

## 9. Các kiểm tra không thể kết luận chỉ từ việc bấm UI

| Kiểm tra | Cách chứng minh bổ sung |
| --- | --- |
| Cross-org/case ACL | Cần hai user có membership thật khác nhau. Đăng nhập user không có quyền, mở exact case/source URL đã lưu: denied404/403, không bytes/metadata. Hai cửa sổ cùng user không chứng minh isolation |
| Session expiry/revocation | Logout kiểm revoke hiện tại; absolute8h/idle30phút là config ban đầu, cần chờ thời gian thật/config hiện hành hoặc test DB riêng |
| CSRF/Origin, idempotency replay/conflict, transaction rollback | Cần kiểm tra HTTP/DB chuyên dụng; UI double-click không đủ chứng minh. Không paste credential-bearing requests vào chat |
| Crash/lease/CAS/concurrency/publication | Dùng isolated security suite, không kill process/DB đang dùng để demo |
| Retention24h | Chờ window thực hoặc suite disposable; không sửa timestamp/trigger của sandbox đang chứa dữ liệu để tạo PASS |

Các lệnh bổ sung được giữ riêng với kết quả test tay:

```powershell
# Offline harness protection
node --test apps/api/test/acceptance-security/harness-protection.test.cjs

# Chạy serial, sau build, khi15432 không bị suite khác giữ.
# Launcher tự tạo DB riêng và dừng khi xong; không phải sandbox UI lâu dài.
node apps/api/test/acceptance-security/run-security-tests.cjs --run
```

## 10. Mẫu ghi kết quả

| Bước | Case | PASS/FAIL/BLOCKED/NOT RUN | Expected vs actual | Evidence/time |
| --- | --- | --- | --- | --- |
| 14–18 | RECEIVABLE | Chưa chạy | Upload → live extraction → exact source → correction giữ raw | Case/job IDs, ảnh đã che, hash |
| 21–28 | RECEIVABLE | Chưa chạy | Review/request/export/supplement/waiver | Request ID, export hash |
| 29–36 | RECEIVABLE | Chưa chạy | Staff/native/receipt/revoke/verification | Response revision, không token |
| 37–43 | RECEIVABLE | Chưa chạy | Financial sets/source/stale/FHI null | Set/fact revisions |
| 44 | PREPAYMENT | Chưa chạy | Lặp quy trình, đúng roles | Case ID |
| 45–49 | Cả hai | Chưa chạy | Conflict/logout/layout/persistence/retry | HTTP status, thời gian |

PASS chỉ khi actual khớp expected. Thiếu setup/quyền/nguồn hợp lệ ghi BLOCKED; chưa thực hiện ghi NOT RUN. Không báo test hết/security đầy đủ nếu mới chạy happy path hoặc còn các mục trên chưa kiểm chứng.
