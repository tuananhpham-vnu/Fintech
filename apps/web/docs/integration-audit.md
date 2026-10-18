# Rà soát và tích hợp frontend — 16/10/2026

Baseline: AIC Rating 2.0.0 / CR-AIC-01 / METHOD-SYNC-01; AIC-FHI-1.0 / 1.0.0. Đây là frontend chuẩn bị cho API AIC v2, chưa phải hệ thống tích hợp backend thật.

## Kiến trúc, xung đột và quyết định

Checkout ban đầu chỉ có `packages/contracts`, `services/ai` và bản nhập `apps/FE Fintech`; không có frontend cũ khác hoặc `apps/api`. README gốc mô tả Blueprint 1.0.2, `/api/v1`, reviewer/contributor và hồ sơ vay. Notion hiện hành chuyển sang specialist, đối tác/giao dịch RECEIVABLE/PREPAYMENT và `/api/v2`. Không nối hai baseline bằng đổi tên field/URL.

Giữ bản nhập, sao chép source/config/tests/assets/docs cần thiết sang `apps/web`; đã đối chiếu SHA-256 của 96 file source/style trước sửa. Bản nhập không thuộc workspace và được ignore. Không sửa AI, contracts, Render, DB hoặc dữ liệu thật. Chưa tạo commit/PR/deploy.

Root workspace chỉ chứa `apps/web`. Node_modules bản nhập chép từ vị trí khác làm hỏng package links/bin. Lockfile ngoài cùng bản nhập chỉ khóa pnpm 12.3.4; root lock được chuyển từ lock dependency thực (`apps/FE Fintech/node_modules/.pnpm/lock.yaml`), đổi importer sang `apps/web`, giữ phiên bản thư viện. Dùng pnpm 11.22.0 có sẵn; cài frozen lockfile thành công.

| Phần đã đánh giá                                          | Quyết định                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Next.js 16.4 / React 19 / TypeScript; App Router          | Tái sử dụng; đọc hướng dẫn Next đi kèm package trước sửa                        |
| 10 feature, API adapters, shared hooks/UI, thin routes    | Giữ cấu trúc, các URL hiện có và sáu tab                                        |
| Transport/proxy, CSRF, idempotency, revision, source hash | Giữ ranh giới; kiểm consumer và HTTP proxy thật                                 |
| PDF.js local worker/CMaps/fonts/WASM                      | Giữ; remount đúng nguồn/trang khi đổi evidence                                  |
| Styles base/workspace/theme, icons                        | Giữ; thêm wrap số tiền rất lớn/công thức dài                                    |
| Resource theo ID/revision/cursor                          | Không cho dữ liệu loader cũ xuất hiện như snapshot mới; bỏ kết quả abort        |
| Method lifecycle và rating UI                             | Enum mới; FHI 7 metric/4 nhóm, riêng Transaction Review; không scorer ở FE      |
| Country hardcode VN                                       | Cho nhập/đọc quốc gia theo DTO mới; VN là mặc định demo; ID giữ dạng chuỗi      |
| Write thiếu payload chuẩn                                 | Giữ `CONTRACT_NOT_RELEASED`, draft và leave guard                               |
| Harness/fixtures                                          | Chỉ loopback, dữ liệu RAM tổng hợp; cấu hình cổng QA để tránh tiến trình sẵn có |

## Ma trận màn hình → API → kiểm tra

Cột QA chỉ xác nhận frontend/dữ liệu tổng hợp; chưa nghiệm thu ACL, DB, OCR/model hoặc policy backend.

| Màn hình/luồng            | API/ranh giới                    | Hiện trạng và bằng chứng                                                                                                                    |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Login/session             | auth login/me/logout             | Consumer và HTTP QA; browser đăng nhập sai/đúng. Browser hết phiên/khác identity chưa chạy xong                                             |
| Counterparties            | list/create/update               | Browser tạo US supplier, ID `000UI2026`, mở edit giữ country/ID; search trang. Browser phân trang chưa đủ                                   |
| Cases/create/overview     | case/exposure                    | Browser tạo RECEIVABLE/PREPAYMENT; bốn cặp role đúng, proposed; tiền `900719925474099312345` chính xác                                      |
| Conflict                  | expected_revision                | Browser 409 giữ draft, tải revision mới, adopt và gửi lại thủ công thành công                                                               |
| Files/jobs                | documents/source/extraction/jobs | HTTP multipart, source/extraction; browser thấy job failed, trường unreadable/null. Upload browser bị extension chặn chọn file              |
| PDF/evidence              | document/version/hash/page       | Browser canvas PDF 4 trang render; source trang 1, evidence trang 4 đúng nguồn/hash                                                         |
| Document Review           | review-runs/issues               | Browser chạy review khi numeric blocked; completed có findings/source; resolve chờ completion                                               |
| Waiver/history            | waivers/revoke/history           | Browser waiver giữ Open + Waived; old run stale, resolve disabled. HTTP revoke/audit đã chạy                                                |
| Non-Financial Information | questionnaire/response/invite    | Tab/sáu nhóm BA hiển thị; write pending. Staff/verify/invite chưa nghiệm thu browser                                                        |
| FHI                       | readiness/assessment             | 7 metric, nhóm 25/20/25/30; số chỉ từ server khi readiness cho và đủ bảy component; không reweight                                          |
| Transaction Review        | draft assessment expansion       | Riêng BLOCKED/FOLLOW_UP/CLEAR_FOR_REVIEW/UNKNOWN; không blend/approval. QA 73.7/AIC-F2 vẫn Unknown                                          |
| Acknowledgement           | acknowledge/history              | Browser thêm audit với reason/actor và revision 1 → 1; không quyết định giao dịch                                                           |
| Requests                  | draft/decide/export              | Browser Save draft báo pending, giữ nội dung và leave guard. Consumer/HTTP export bytes; browser approve/export chưa đủ                     |
| Respondent                | capability form                  | HTTP valid/invalid token; unit required/skip/type/state. Browser chưa chạy; submit pending, không receipt giả                               |
| Errors                    | decoder/proxy                    | Browser 403/409/422/429/503; consumer 401/malformed/204/CSRF/idempotency; 404/private route kiểm HTTP                                       |
| Responsive                | 1440/1280/1024/768/390           | Đã bấm sáu tab trên 5 viewport trước patch cuối; không tràn trang. Sau load thấy tiền lớn bị cắt, đã thêm wrap nhưng browser retest bị chặn |
| EN/VI/ZH                  | LocaleProvider                   | Code lưu preference, không remount/dịch source. Browser đổi locale/giữ draft chưa hoàn tất                                                  |

## Chưa hoàn thiện và giới hạn

Notion có đặc tả scorer pilot, nhưng **policy production vẫn unconfigured**. FE không triển khai scorer, bật pilot hoặc gọi `/internal/v2/analyze`. Điểm QA 73.7/AIC-F2 là fixture từ ví dụ Notion, có nhãn QA/experimental; không phải tính thật hoặc validation. Sáu nhóm BA không điểm; grade/pd không hiển thị, decoder từ chối giá trị không null.

`financial_health`, `transaction_review` và component/source facts là consumer types theo dự thảo, không phải schema phát hành. Fact → document, period/basis/scope và method-registry anchors chưa có API mapping; UI báo chờ tích hợp. Không coi fact ID là evidence ID. Cần AIC-B01 khóa schema rồi kiểm backend thật.

G01–G11 trong handoff cũ vẫn cần giải quyết: login/cookie/envelope; conditions/paid/received claims; manual review/correction/classification; request draft/revision; questionnaire/staff/verification/invitation/respondent submit; external sources. Chưa phát minh endpoint hoặc đổi logic để ép UI thành công.

Kết quả/lệnh ở [verification](verification.md), log trong `.reports/`. Lint là architecture + Prettier, không ESLint. AI regression: 361 passed, 4 skipped, 1 failed do kỳ vọng prompt `extraction-v1` nhưng code trả `extraction-v2`; AI/contracts không sửa. Không coi suite này là AIC v2 integration.

Đã đọc trực tiếp master và phần hiện hành Notion 01/02/03/04/06/09/10/11/12/13 qua Chrome; không sửa Notion. Connector trả 404. Trang DB 08 và các trang phân công/dependency chưa đọc đầy đủ. Không tuyên bố đã đối chiếu toàn bộ tài liệu dự án.

Local browser use bị tắt trong Work settings khi đang kiểm tra tiếp. Ảnh `.reports/browser/` thuộc build trước patch cuối về wrap, guard/decoder và validator, không chứng minh retest bản cuối. Upload UI thiếu extension permission “Allow access to file URLs”; chỉ HTTP upload có bằng chứng. Không tuyên bố toàn hệ thống PASS/production ready.
