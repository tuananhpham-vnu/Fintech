# apps/rules-demo/static

Giao diện demo, viết bằng HTML/CSS/JS thuần, không cần bước build.

| File | Trang | Vai trò |
|---|---|---|
| `index.html` + `simple.js` | `/` Đơn giản | 3 bước hướng dẫn, thẻ ví dụ, form hồ sơ, kết quả bằng lời thường |
| `advanced.html` + `advanced.js` | `/advanced` Chuyên sâu | Bố cục **UI03 Bàn rà soát**: phát hiện bên trái, chi tiết và nguồn bên phải; tab kết quả rule, đầu vào, JSON |
| `common.js` | Cả hai | Nhãn tiếng Việt, hàm `h()` tạo DOM, `api()`, định dạng tiền |
| `styles.css` | Cả hai | Biến màu trên `:root`, chế độ tối, giao diện điện thoại |

Quy ước khi sửa:

- Chỉ tạo DOM qua `h()`, vốn dùng `textContent`. Không dùng `innerHTML` với dữ liệu.
- Trạng thái luôn có chữ đi kèm màu. Không hiển thị phần trăm tự tin.
- Câu chữ hướng tới người không chuyên. Luôn nói rõ đây là *đề xuất* và chuyên viên quyết định; không dùng từ “phê duyệt” hay “kết luận cho vay”.
- `common.js` phải được nạp trước `simple.js` / `advanced.js` (các file dùng chung biến toàn cục).
