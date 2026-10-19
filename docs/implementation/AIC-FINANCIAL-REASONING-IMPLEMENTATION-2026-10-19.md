# Bàn giao suy luận số liệu BCTC — 19/10/2026

Đã triển khai V1 vào luồng intake, import, registry và web local. Đây là bản triển khai có kiểm soát để rà soát thực tế, chưa phải nghiệm thu độ chính xác cho mọi BCTC. Method, scorer, trọng số và ngưỡng hiện hành được giữ nguyên.

## Hành vi đã có

- AI đọc theo batch và giữ các số nguồn ngoài 14 đầu vào, gồm số dư, thành phần, dự phòng và số 0 in rõ. Nhãn và số được kiểm lại trong quote/trang gốc; đơn vị, kỳ và cơ sở báo cáo phải khớp.
- Planner đề xuất biến trung gian, phương trình kế toán, biểu thức có toán hạng đã biết và trang cần đọc thêm trong cùng PDF. Không gửi toàn bộ ZIP trong một prompt. Một item quan hệ sai schema không làm mất các item hợp lệ khác.
- API giải hệ tuyến tính bằng rational chính xác, hỗ trợ tìm ngược nhiều ẩn, chuỗi tính và cộng/trừ/nhân/chia với kiểm đơn vị. Không chọn nghiệm tùy ý, không coi biến tự do hoặc ô trống là 0, không làm tròn kết quả vô hạn để phát fact.
- Các đường tính/số nguồn mâu thuẫn bị chặn. Không dùng confidence hay lấy trung bình các đáp án. Phải thu gộp không được đổi tên thành số thuần; dự phòng chung khác 0 phải có căn cứ phân bổ. Sai dấu dự phòng cũng bị chặn.
- Với bảng hai kỳ có tiêu đề nhận diện được, kiểm thêm cột năm hiện tại/năm so sánh. Phân biệt số dư đầu năm trên bảng cân đối và dòng tiền đầu kỳ của mỗi cột năm. Các layout chưa nhận diện được vẫn cần con người đối chiếu cột; không tuyên bố đã xác minh độc lập mọi layout.
- Mỗi kết quả giữ quan hệ, số trung gian, tập lá nguồn và proof hash. Khi áp dụng, BE tính lại từ receipt bất biến; sửa giá trị ở client bị từ chối.
- Web hiển thị coverage, trạng thái 14 đầu vào, công thức/nguồn và nguyên nhân chưa tính được. Có kho nguồn phân trang, loại dòng OCR hoặc quan hệ sai bằng quyết định có lý do, lưu receipt/revision mới và tính lại. Thay nguồn/quan hệ làm mất hiệu lực xác nhận cũ; xác nhận chung vẫn là bước trước chấm điểm.

## Persistence và API

Migration cộng thêm `0023_financial_reasoning.sql` tạo bốn bảng: runs, observations, relations, derivations, đều có lịch sử bất biến và ràng buộc tenant/case. Không sửa checksum migration 0001–0022, không sửa/xóa hồ sơ cũ.

Local đã sao lưu trước migration tại `C:/Users/52duc/AppData/Local/Temp/aic-dev-backup-Vd1jWn/before-migration.dump`. Trước UAT có 1 đối tác, 2 hồ sơ và 3 intake cần rà soát. UAT tạo thêm một hồ sơ riêng cho cùng đối tác; không sửa hai hồ sơ cũ.

- `GET /api/v2/cases/{id}/financial-reasoning/{receipt}?offset=0`: tối đa 50 quan sát và 10 quan hệ/lần, ACL theo hồ sơ.
- `POST /api/v2/cases/{id}/financial-reasoning/{receipt}/decisions`: revision, idempotency, set ID, các observation/relation cần loại và lý do; không cho sửa receipt lịch sử.
- Schema AI, schema API, OpenAPI và checksum foundation được cập nhật bằng generator `scripts/extend-financial-reasoning.cjs`, cũng được gọi sau generator calculations.

## Cấu hình và vận hành

`.env` local đã bật `AI_FINANCIAL_REASONING=1` và `AI_REASONING_CACHE=1`. Provider đang dùng DeepSeek, model `deepseek-flash`; không đổi key và không bật provider dự phòng.

Vẫn chạy bằng `pnpm dev:all`. Cache OCR/quan sát nằm dưới `AI_STORAGE_DIR/reasoning-cache`, gắn source/model/prompt/schema, TTL 30 phút, tối đa 256 file × 1 MB. Cache không thay thế chứng cứ DB; kết quả đọc lại vẫn qua grounding.

Giới hạn V1: 240 biến, 500 quan sát, 100 quan hệ, 20 ẩn trong mỗi hệ liên thông, 8 tầng quan hệ, 3 lượt tìm nguồn; tối đa 16 trang scan được chọn ban đầu và tìm bổ sung có hạn mức thời gian. Coverage thiếu hoặc hết budget phải hiển thị riêng, không kết luận BCTC thật sự thiếu số.

Rollback hành vi tạo receipt mới: đặt `AI_FINANCIAL_REASONING=0` rồi khởi động lại. Đường calculations V1 và khả năng đọc receipt V2 vẫn được giữ; không cần xóa bảng hoặc dữ liệu. Muốn tắt cache, đặt `AI_REASONING_CACHE=0`.

## Kiểm thử và chứng cứ

Unit/integration bao phủ hệ duy nhất/thiếu hạng/vô nghiệm, chuỗi nhiều bước, biểu thức, số vượt giới hạn integer JS, đơn vị/kỳ/currency, số 0, sai dấu, gross/net, giả định, stale confirmation, ACL, chống sửa giá trị, bất biến DB và rà soát loại nguồn/quan hệ. Oracle số học có 40 bộ dữ liệu synthetic, tạo bằng Python Fraction với công thức đóng độc lập với RREF BE; script nằm ở `scripts/generate-financial-reasoning-oracle.py`.

Kiểm thử DeepSeek thật trên OCR đã đối chiếu hash của cả BCTC 2024 và 2025, mỗi báo cáo 8 trang. Đây là phép thử suy luận trên OCR có sẵn, không được gọi là benchmark OCR cold start. Đầu ra AI thay đổi giữa các lượt; có thể còn cần rà soát hoặc thử lại dù tài liệu có số.

Chrome UAT tải PDF 2024 thật vào hồ sơ `507633d1-9b82-4672-9830-15dc8a42c954`, chạy worker thật, nhận diện 2024 và cột so sánh 2023. Đã tái hiện quan hệ AI thiếu thành phần đầu tư ngắn hạn gây lệch 12 tỷ; loại quan hệ qua UI tạo receipt mới, bỏ conflict và giữ nguyên số nguồn. Sau đó chọn áp dụng tương đương tiền 0 và nợ vay 38.766.682.010 từ các dòng có nguồn. Phải thu thuần và D&A không được tự điền để ép đủ 14 đầu vào.

Log/JSON/screenshot dữ liệu thật được giữ local dưới `.reports/financial-reasoning-2026-10-19/` và gitignored, không đưa vào fixture công khai. Ảnh kết quả đã lưu: `chrome-uat.png` và `chrome-uat-results.png`.

Kết quả kiểm tra cuối:

| Bộ kiểm tra | Kết quả |
|---|---|
| AI `pytest tests -q` từ `services/ai`, tắt dotenv/feature flag trong fixture | 784 đạt, 4 bỏ qua |
| Backend `pnpm api:test:mvp` | 267 test đạt; PostgreSQL disposable, gồm suy luận, receipt, ACL, chỉnh nguồn/quan hệ, tính lại và stale confirmation |
| Frontend `pnpm check:aic` | 83 unit + 20 integration đạt; architecture check đạt |
| `pnpm typecheck`, API TypeScript build | Đạt |
| Prettier các file financial mới/sửa | Đạt |

Lượt DeepSeek thật cuối: 2024 có 81 quan sát/8 quan hệ, 2025 có 77 quan sát/11 quan hệ; BE giải được 12/14 đầu vào của mỗi báo cáo, còn phải thu thuần và D&A. Nợ vay ra đúng 38.766.682.010 cho 2024 và 60.001.037.460 cho 2025. Thời gian bước reasoning khoảng 10,30 và 20,36 giây trong lượt cache ấm, không gồm OCR cold start. Một số quan sát lặp của 2025 không khớp quote bị loại; các fact trực tiếp hợp lệ vẫn được giữ. Chi tiết tại `final-live-summary.json`.

Trong lúc kiểm tra có thay đổi UI đồng thời ở `company-workspace.tsx`; đã giữ các thay đổi i18n đang có và khôi phục type import cần thiết để typecheck qua. Không rollback các thay đổi giao diện đó.

## Điều kiện còn mở trước nghiệm thu rộng

- Chưa có đủ 12 BCTC thực tế đa bố cục cùng gold kế toán độc lập để kết luận độ bao phủ/độ chính xác release. Hai báo cáo HK VINA và oracle synthetic chưa thay thế được bộ đó.
- Graph hiện gắn một receipt/PDF; tìm thuyết minh trong cùng PDF đã có. Chưa tự ghép quan sát từ các PDF thuyết minh độc lập trong ZIP thành một proof liên tài liệu. Các file vẫn được intake riêng; không tự gộp chỉ vì cùng nhãn/năm.
- Concept dictionary V1 và các guard không phải bộ ontology kế toán hoàn chỉnh. Membership cha/con, điều kiện thuyết minh và ngữ nghĩa quan hệ vẫn cần rà soát; BE xác minh toán học không thay thế xác nhận nghiệp vụ.
- Chưa có bảo đảm tự động 14/14 cho mọi tài liệu. Đặc biệt, dự phòng chung không phân bổ không xác định được phải thu khách hàng thuần duy nhất; thiếu biến động khấu hao/phân bổ không chứng minh được D&A kỳ chỉ từ số dư TSCĐ bằng 0.
- Bbox/ô/cột chi tiết cho mọi engine OCR, proof liên tài liệu và benchmark nhiều doanh nghiệp là các hạng mục còn phải hoàn thiện theo kế hoạch gốc. Không phát điểm từ các đầu vào chưa đủ căn cứ để né các điều kiện này.
