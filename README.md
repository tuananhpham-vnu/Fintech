# MVP rà soát hồ sơ vay SME

Ứng dụng hỗ trợ chuyên viên tín dụng tìm thông tin **thiếu hoặc chưa khớp** trong hồ sơ vay của doanh nghiệp nhỏ.
Mọi phát hiện đều có nguồn kiểm tra được. Chuyên viên duyệt yêu cầu bổ sung; khi hồ sơ mới được nộp, hệ thống đối chiếu lại và lưu lịch sử.
Hệ thống **không** đánh giá khả năng trả nợ, không kết luận pháp lý và không phê duyệt khoản vay.

Đặc tả đầy đủ nằm ở `Tai_lieu_trien_khai_MVP_SME_Review.docx` (v1.0).

## Ba phần và cách ghép

```
App (fullstack) → Đọc hồ sơ (Facts + Evidence) → Đối chiếu (Findings + SuggestedRequests) → App hiển thị để chuyên viên duyệt
```

| Phần | Người | Thư mục | Đầu ra |
|---|---|---|---|
| Fullstack và tích hợp | Bạn | `apps/web`, `apps/api` (chưa có) | App chạy trọn vòng |
| Đọc tài liệu và dữ liệu | Anh Nguyên | `services/extraction` (chưa có) | `Facts + Evidence` |
| Đối chiếu và kiểm chứng AI | Anh Tuấn Anh | [services/rules](services/rules) | `Findings + SuggestedRequests` |

Các phần nói chuyện với nhau qua contract trong [packages/schemas](packages/schemas). Đổi trường dữ liệu phải cập nhật schema, ví dụ JSON và test.

## Cấu trúc repo

| Thư mục | Nội dung |
|---|---|
| [apps/](apps) | Ứng dụng chạy được; hiện có [apps/rules-demo](apps/rules-demo) (demo đối chiếu, deploy lên Render) |
| [services/](services) | Module nghiệp vụ; hiện có [services/rules](services/rules) (R01–R10) |
| [packages/](packages) | Contract dùng chung: JSON Schema và ví dụ |
| `render.yaml` | Blueprint deploy demo lên Render |

## Dùng thử demo (cho người xem)

Mở link demo (ví dụ `https://sme-review-rules-demo.onrender.com`), không cần cài đặt hay đăng nhập.

**Lần đầu mở trang, một hướng dẫn 1 phút tự hiện ra**, đi qua từng phần bằng hồ sơ mẫu Công ty Sao Mai. Muốn xem lại thì bấm **▶ Hướng dẫn** ở góc trên. Khi gửi link cho người khác, có thể dùng `…/?tour=1` để luôn mở hướng dẫn.

1. **Chọn một ví dụ**: bấm vào một thẻ, kết quả hiện ngay.
2. **Hoặc tự sửa hồ sơ** trong form (bỏ tick giấy tờ, đổi số liệu) rồi bấm **Kiểm tra hồ sơ**.
3. **Đọc kết quả**: hệ thống ghi rõ có bao nhiêu vấn đề, **việc nên làm**, và **Xem căn cứ** (trích dẫn từ tài liệu nào, trang nào).

| Muốn xem | Làm thế này | Kết quả mong đợi |
|---|---|---|
| Cả vòng bổ sung hồ sơ | Bấm lần lượt Bước 1 → 2 → 3 (hoặc nút “Tiếp tục”) | Thiếu biên bản → nộp nhầm HĐ02 vẫn mở → nộp đúng thì chỉ *đề xuất* đóng |
| Hồ sơ sạch không bị báo thừa | Ví dụ “Hồ sơ đầy đủ, khớp” | Không phát hiện vấn đề |
| Thiếu giấy tờ | Bỏ tick “Báo cáo tài chính” → Kiểm tra | Thiếu BCTC + yêu cầu bổ sung |
| BCTC không cân | Đổi “Vốn chủ sở hữu” từ 400 thành 390 | Chênh 10 triệu, kèm công thức |
| MST sai | Điền hóa đơn 220, MST người bán `0000000007` | Mã số thuế chưa khớp (ưu tiên cao) |
| Khai đã thu tiền | Chọn “Đã thu tiền”, biên bản “Có sẵn” | Chưa có chứng từ thanh toán phù hợp |
| Thu một phần | Như trên + chứng từ ngân hàng 200 | 200 triệu có chứng từ, 300 triệu chưa rõ |
| Hóa đơn vượt hợp đồng | Hóa đơn 600, hợp đồng 500 | Tổng hóa đơn vượt giá trị hợp đồng |

Người cần xem chi tiết kỹ thuật (mã rule, số hạng tính, JSON, nhập JSON tùy chỉnh) mở **Chế độ chuyên sâu** ở góc trên (`/advanced`).

## Chạy nhanh trên máy

Cần Python ≥ 3.9.

```bash
python3 -m venv .venv
.venv/bin/pip install -e "services/rules[dev]" -r apps/rules-demo/requirements.txt httpx

# Test
(cd services/rules && ../../.venv/bin/python -m pytest -q)
(cd apps/rules-demo && ../../.venv/bin/python -m pytest -q)

# Chạy demo: http://localhost:8000
.venv/bin/uvicorn main:app --app-dir apps/rules-demo --reload
```

## Deploy demo lên Render

Repo đã có sẵn [render.yaml](render.yaml), nên Render tự đọc cấu hình.

1. Push repo lên GitHub/GitLab.
2. Trên Render Dashboard chọn **New → Blueprint**, chọn repo, rồi **Apply**.
3. Render chạy build `pip install -r apps/rules-demo/requirements.txt ./services/rules` và start `uvicorn main:app --app-dir apps/rules-demo --host 0.0.0.0 --port $PORT`.
4. Kiểm tra `https://<tên-service>.onrender.com/healthz` trả `{"status":"ok"}`, sau đó mở trang chủ.

Gói free của Render tắt service khi không có truy cập, nên lần mở đầu tiên có thể mất khoảng 30–60 giây. Trước buổi demo nên mở trang sẵn.
Demo chỉ dùng dữ liệu giả lập; **không** dán hồ sơ khách hàng thật vào ô JSON tùy chỉnh.
