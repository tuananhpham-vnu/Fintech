# Nguồn đặc tả hiện hành — 16/10/2026

Đối chiếu trực tiếp qua UI Notion. Các `.txt` đi kèm là snapshot bản nhập, một số URL/yêu cầu đã cũ; giữ nguyên để truy vết, không dùng để phủ định METHOD-SYNC-01.

| Trang đã đọc phần hiện hành | URL                                                       |
| --------------------------- | --------------------------------------------------------- |
| 00 master                   | https://app.notion.com/p/1790c2f0937d8344bc9781bc9b4efd32 |
| 01 domain                   | https://app.notion.com/p/b940c2f0937d83f48e5b01d233063b85 |
| 02 rules                    | https://app.notion.com/p/e680c2f0937d8364bf9e818fed4ee4a6 |
| 03 tests                    | https://app.notion.com/p/6270c2f0937d831fa94d0168aaa797e2 |
| 04 architecture/flows       | https://app.notion.com/p/a610c2f0937d83a7b753018a43729539 |
| 06 security                 | https://app.notion.com/p/d170c2f0937d837b9fcf01de41335f03 |
| 09 operations               | https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425 |
| 10 DTO                      | https://app.notion.com/p/ef40c2f0937d839a8799814ce182e69f |
| 11 product                  | https://app.notion.com/p/83e0c2f0937d82848f6081a001d0b767 |
| 12 frontend                 | https://app.notion.com/p/9cd0c2f0937d82499c448102014376f1 |
| 13 methodology              | https://app.notion.com/p/bf10c2f0937d832d936281ed21fe903f |

Phân công Đức đọc phần đầu tại https://app.notion.com/p/8cb0c2f0937d82c098e98120d4c82ec7. Trang 08 DB và phân công/dependency/design review chưa đọc đầy đủ; không khẳng định đối chiếu toàn bộ báo cáo.

Thay đổi so snapshot nhập: AIC-FHI-1.0/1.0.0 thay nghiên cứu/ứng viên cũ; 7 metric, nhóm 25/20/25/30, không reweight; financial_health riêng transaction_review; lifecycle `unconfigured/configured_pilot/validation_pending/validated_for_limited_use/retired`; band AIC-F1–F5 không là credit rating; grade/pd luôn null; production policy unconfigured. Counterparty có thể quốc tế, VN chỉ mặc định demo. API/DB/schema máy đọc chưa phát hành.

Một số đoạn chung còn dùng provisional hoặc score/grade; METHOD-SYNC-01 và trang 13 hiện hành ưu tiên cho FHI. Không tự suy ánh xạ đầy đủ trước khi wire schema khóa.
