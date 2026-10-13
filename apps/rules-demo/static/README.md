# apps/rules-demo/static

Giao diện demo, bố cục theo màn hình **UI03 Bàn rà soát**: danh sách phát hiện bên trái, chi tiết và nguồn bên phải.
Không dùng framework hay bước build, nên Render chỉ cần phục vụ file tĩnh.

| File | Vai trò |
|---|---|
| `index.html` | Khung trang: danh sách kịch bản, tóm tắt run, ô R01–R10, các tab, hộp thoại JSON |
| `styles.css` | Biến màu trên `:root`, có chế độ tối theo hệ điều hành; màn hình hẹp hơn 760px chuyển sang một cột |
| `app.js` | Gọi API, quản lý state và render bằng DOM |

Quy ước khi sửa:

- Chỉ tạo DOM qua hàm `h()`, vốn dùng `textContent`. Không dùng `innerHTML` với dữ liệu, vì ô JSON tùy chỉnh nhận input tự do.
- Trạng thái luôn có chữ đi kèm màu (Vấn đề / Chưa rõ / Đạt / Không áp dụng), không chỉ dựa vào màu.
- Không hiển thị phần trăm tự tin. Phát hiện luôn ghi “Hệ thống đề xuất · chờ chuyên viên…”.
- Ô trang nhỏ cạnh trích dẫn vẽ `bbox` theo tọa độ chuẩn hóa 0–1. Evidence không có bbox thì viền cả trang.
- Số tiền: các trường `*_vnd` trong `operands` được định dạng `500.000.000 VND`.
