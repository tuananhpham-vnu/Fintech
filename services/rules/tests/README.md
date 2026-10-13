# services/rules/tests

```bash
cd services/rules && ../../.venv/bin/python -m pytest -q
```

| File | Nội dung | Mã test trong tài liệu |
|---|---|---|
| `test_normalize.py` | MST, tên viết tắt, quy đổi đơn vị, đơn vị làm tròn, số tham chiếu, ngày | T04 (phần chuẩn hóa) |
| `test_rules_identity_fs.py` | Checklist, MST, tên, cơ sở và phương trình BCTC | T01–T05 |
| `test_rules_transactions.py` | Hóa đơn trùng, hóa đơn so với hợp đồng, liên kết reviewer | T06–T07 |
| `test_rules_receipts.py` | Khoản thu nghiệm thu, phát biểu đã thu, tài liệu bổ sung; kịch bản demo Sao Mai | T08–T10 |
| `test_engine.py` | Đủ 10 rule, cô lập lỗi, mở rộng registry, kiểm tra nguồn, câu chữ, JSON, benchmark | Q03, SEC05/06 |
| `conftest.py` | Fixture `run` và các helper `results / statuses / issues` | – |

Dữ liệu test dựng bằng `sme_rules.fixtures.SnapshotBuilder`, xuất phát từ `sao_mai_base()` rồi thêm hoặc bớt tài liệu.
Muốn bỏ một loại tài liệu thì dùng `builder.remove_documents(DocType.X)`, vì hàm này xóa cả fact và evidence đi kèm.

Khi sửa bug: thêm test tái hiện nguyên nhân trước rồi mới sửa (phần 28).
