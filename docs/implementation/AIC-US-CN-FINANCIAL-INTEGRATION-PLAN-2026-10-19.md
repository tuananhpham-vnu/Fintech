**KẾ HOẠCH TÍCH HỢP BCTC MỸ VÀ TRUNG QUỐC VÀO AIC RATING**

Ngày lập: 19/10/2026. Trạng thái: **chủ sản phẩm đã duyệt; đã triển khai code và cấu hình pilot cục bộ; chưa nghiệm thu UI/AI thật**. Chi tiết bàn giao và giới hạn hiện tại: [AIC-US-CN-IMPLEMENTATION-2026-10-19.md](AIC-US-CN-IMPLEMENTATION-2026-10-19.md).

Mục tiêu: doanh nghiệp trong phạm vi được hỗ trợ có thể nạp một hoặc nhiều BCTC của Mỹ/Trung Quốc, kiểm tra số liệu và nhận điểm cho những chỉ tiêu đủ dữ liệu. Kết quả giữ được nguồn, kỳ, cách tính và mức độ đầy đủ. Việc tích hợp không được làm thay đổi kết quả Việt Nam hiện có.

**1. Quyết định nghiệp vụ đề nghị duyệt**

| Nội dung | Phương án đề xuất |
|---|---|
| Phạm vi đầu tiên | Doanh nghiệp thương mại/phân phối/bán buôn, cùng phạm vi ngành của pilot hiện tại. Mỹ: US GAAP; Trung Quốc đại lục: ASBE/CAS. |
| Ngoài phạm vi đợt đầu | Ngân hàng, bảo hiểm, chứng khoán, quỹ và ngành cần mô hình riêng; báo cáo thuế thay cho BCTC; chế độ SME Trung Quốc và IFRS/HKFRS chưa có adapter được nghiệm thu. Nhận diện và giải thích rõ, không ép vào chuẩn hỗ trợ. |
| Tài liệu tối thiểu | Một báo cáo có ít nhất một chỉ tiêu tính được sau rà soát nguồn. Không bắt buộc đủ nhiều năm hoặc đủ cả 7 chỉ tiêu mới hiện kết quả. Một file có thể chứa nhiều kỳ hợp lệ. |
| Cách tổng hợp | Tính điểm riêng từng chỉ tiêu trong từng năm tài chính hợp lệ; bình quân các điểm của cùng chỉ tiêu; cộng điểm thành phần theo trọng số hiện có, mỗi trọng số chỉ áp dụng một lần. |
| Thiếu dữ liệu | Giữ N/A ở phần thiếu; hiện điểm đã có trên trọng số đã có, số chỉ tiêu và số kỳ đóng góp. Không tự coi thiếu là 0, không chia lại trọng số để tạo điểm /100. |
| Tính chất điểm US/CN ban đầu | Điểm sức khỏe tài chính thử nghiệm, phiên bản phương pháp riêng. Có thể tính và kiểm chứng số học; chưa tuyên bố là mô hình tín dụng đã hiệu chỉnh theo thị trường hoặc xác suất vỡ nợ. PD giữ null. |
| Trọng số/đường chấm điểm | Giữ bộ trọng số và đường chấm điểm hiện tại làm cấu hình pilot ban đầu cho US/CN; lưu phiên bản riêng, không tuyên bố điểm cùng giá trị đồng nghĩa cùng rủi ro giữa các nước. |
| Bảo toàn VN | Giữ phương pháp, ngữ nghĩa trường, kết quả cũ và dữ liệu gốc VN. Cơ chế mới chỉ áp dụng khi chọn đúng profile được bật. |
| Chi phí UAT AI | Đề xuất tối đa 6 hồ sơ mới cần AI trong đợt UAT, tổng trần 2 USD; phải có bộ đếm và chặn chi phí trước khi chạy thật. Mọi lần gọi OCR/AI/repair đều tính vào trần. |

Chủ sản phẩm đã duyệt kế hoạch, gồm trần UAT tối đa 6 hồ sơ mới và 2 USD. Đã bổ sung cơ chế giữ ngân sách trước mỗi lần gọi nhà cung cấp, kể cả retry; giới hạn 6 hồ sơ được kiểm soát bằng kịch bản UAT. Đợt triển khai này chưa gọi DeepSeek thật.

**2. Hiện trạng đã kiểm tra trong repository**

| Thành phần | Hiện trạng | Khoảng trống phải giải quyết |
|---|---|---|
| Contract nhập tài chính | Có VN/US/CN, US_GAAP/CN_ASBE/IFRS, USD/CNY và hệ số đơn vị | Enum chưa chứng minh một luồng sản phẩm đã hoạt động. Cần profile được hỗ trợ và kiểm thử. |
| AI extraction | Có từ khóa Việt/Anh/Trung và kiểm chứng nhãn/số/nguồn | Chưa đủ quy tắc theo phiên bản chuẩn; các nhãn tương tự có thể khác bản chất. |
| Company intake | Chặn ngoài VN; có chỗ gán cứng country VN khi yêu cầu trích xuất và ghi statement | Phải truyền và kiểm tra quốc gia thực tế xuyên suốt, không chỉ mở dropdown. |
| Scoring | Chặn COUNTRY_METHOD_NOT_VALIDATED; policy đang gắn một phương pháp và phạm vi pilot | Cần policy/profile cho từng quốc gia, chuẩn và phiên bản. |
| Tổng hợp và trends | Chỉ coi FY từ 01/01 đến 31/12 là hợp lệ | Phải hỗ trợ niên độ lệch và năm 52/53 tuần có chứng cứ. |
| Quick ratio | Đòi cash và cash equivalents tách riêng | Báo cáo Mỹ thường trình bày gộp; cần biểu thức đủ điều kiện mà không giả tạo hai trường con. |
| M03 đối chiếu bảng cân đối | Hiện chỉ chấp nhận chênh lệch bằng 0 | Báo cáo làm tròn theo nghìn/triệu có thể lệch nhỏ; cần quy tắc làm tròn được định nghĩa riêng cho profile mới. |
| Nguồn và lịch sử | Có fact revision, nguồn, review, snapshot, xử lý nguồn trùng kỳ | Phải mở rộng để lưu mapping/profile/evidence mới; giữ snapshot cũ đọc lại theo phiên bản cũ. |
| OCR/checkpoint | Có cache cục bộ và checkpoint tùy cấu hình, thời hạn ngắn | Cần bảo đảm tái sử dụng an toàn trong phạm vi khách hàng và theo phiên bản; không coi cache hiện có là bảo đảm không tốn phí khi chạy lại. |

Các điểm code chính: apps/api/src/financial/financial-intake.service.ts; financial-registry.service.ts; fhi-policy.ts; fhi-scorer.ts; case-assessment.ts; financial-trends.ts; services/ai/financial_import/service.py, semantics.py, periods.py; packages/contracts/aic-financial-import/.

Tài liệu thiết kế cũ có thể mô tả trạng thái trước các thay đổi gần đây. Khi triển khai sẽ lấy code hiện hành và bộ kiểm thử đã xác nhận làm baseline, không dùng mô tả cũ để suy ra tính năng đã bật.

**3. Kiến trúc tích hợp đề xuất**

Luồng xử lý: tài liệu gốc → nhận diện doanh nghiệp/chuẩn/kỳ → chọn trang/bảng liên quan → trích xuất số gốc → adapter kế toán theo profile → số liệu và phép điều chỉnh có chứng cứ → rà soát → tính từng kỳ → tổng hợp toàn hồ sơ.

Ba tầng có trách nhiệm riêng:

- Tầng dữ liệu gốc lưu nguyên nhãn, con số in trên báo cáo, dấu, tiền tệ, hệ số đơn vị, kỳ, nguồn và vị trí. AI chỉ đề xuất dữ liệu và quan hệ.
- Adapter kế toán giải nghĩa, kiểm tra và tạo phép điều chỉnh từ những số có nguồn. Code thực hiện phép tính bằng decimal/rational; người rà soát xác nhận đề xuất cần phán đoán.
- Tầng phương pháp chọn bộ định nghĩa chỉ tiêu, trọng số, đường chấm điểm và điều kiện xuất kết quả theo profile đã bật.

Profile đề xuất có khóa quốc gia + chuẩn + phiên bản áp dụng + ngành + cơ sở riêng lẻ/hợp nhất + phiên bản chính sách tính điểm. Country, ngôn ngữ và chuẩn kế toán là các thuộc tính độc lập: tiếng Trung không mặc nhiên là ASBE, niêm yết tại Mỹ không mặc nhiên là doanh nghiệp Mỹ hay áp dụng US GAAP.

Các trạng thái khả năng gồm nhận diện được, nhập được, tính tỷ số được và xuất điểm thử nghiệm được. UI lấy trạng thái từ backend. Không mở tính năng bằng cách xóa toàn bộ chốt chặn quốc gia.

**4. Quy tắc ánh xạ kế toán**

| Dữ liệu/nhóm chỉ tiêu | Mỹ | Trung Quốc | Quy tắc áp dụng |
|---|---|---|---|
| Tài sản ngắn hạn, nợ ngắn hạn — M01 | Total current assets/liabilities | 流动资产合计/流动负债合计 | Đúng tổng cộng và ngày cuối kỳ; không dùng một dòng con thay tổng. |
| Tài sản nhanh — M02 | Cash and cash equivalents, receivables net | Tiền/tương đương tiền đủ điều kiện, 应收账款 thuần | Dùng hợp tiền và tương đương tiền khi có chứng cứ đủ điều kiện; trừ phần hạn chế nếu được xác định; tránh đếm hai lần. Không coi toàn bộ 货币资金 là tiền sẵn dùng. |
| Vốn chủ, tài sản, nợ — M03 | Total equity, assets, liabilities | 所有者权益合计, 资产总计, 负债合计 | Hợp nhất phải dùng tổng equity gồm lợi ích không kiểm soát nếu thuộc cơ sở đó; không dùng equity chỉ thuộc công ty mẹ. Đối chiếu A=L+E. |
| Nợ vay chịu lãi — M04 | Borrowings, bonds, current maturities, finance leases theo policy | 短期借款, 长期借款, 应付债券, phần đến hạn và thuê đủ điều kiện | Cộng thành phần đầy đủ, không trùng. Một năm chỉ có một tổng nợ chuẩn hóa, không dùng tổng liabilities thay thế. |
| Lợi nhuận hoạt động — M04/M05/M06 | Operating income theo báo cáo và profile | Phân biệt 营业利润 của cách trình bày cũ với 经营利润 của chuẩn mới | Giữ số gốc; chỉ điều chỉnh khoản tài trợ/đầu tư hoặc khoản ngoài định nghĩa khi có phân loại và chứng cứ đầy đủ. |
| Khấu hao/phân bổ — M04 | D&A của kỳ | 折旧/摊销 của kỳ | Chỉ cộng lại khoản đã trừ vào lợi nhuận đang sử dụng; loại số lũy kế, giảm giá tài sản và khoản không thuộc chính sách. |
| Chi phí lãi vay — M05 | Gross interest expense | 利息费用/利息支出 thuộc kỳ | Không dùng net interest, toàn bộ finance costs hay tiền lãi đã trả để thay thế. Nếu chỉ có dòng gộp thì cần thuyết minh hoặc để thiếu. |
| Doanh thu — M06/M07 | Revenue/net sales đúng phạm vi | 营业收入 đúng phạm vi | Dùng số thuần đúng chuẩn, đúng doanh nghiệp; không cộng thêm doanh thu bộ phận hoặc trừ thuế hai lần. |
| CFO — M07 | Net cash from operating activities | 经营活动产生的现金流量净额 | Đúng khoảng thời gian, giữ chính sách phân loại dòng tiền của chuẩn nguồn và cờ so sánh. |

Giữ trọng số M01–M07 lần lượt **15, 10, 20, 10, 15, 10, 20**.

Các quyết định kế toán cần thể hiện cụ thể trong đặc tả và fixture:

1. **Tiền trình bày gộp:** profile quốc tế cho phép một đầu vào tổng tiền và tương đương tiền đủ điều kiện, hoặc các thành phần rời nhau. Hai cách là lựa chọn thay thế; không cộng đồng thời. Không gán số gộp vào cash rồi tự đặt equivalents=0. Đây là đầu vào/biểu thức mới có phiên bản, không đổi cách đọc fact VN cũ.
2. **Lợi nhuận:** đề xuất dùng lợi nhuận hoạt động trước ảnh hưởng tài trợ và đầu tư ngoài hoạt động theo định nghĩa pilot quốc tế. Công thức tổng quát là số gốc trừ các khoản lãi ngoài định nghĩa đã gồm, cộng các khoản chi ngoài định nghĩa đã khấu trừ. Danh mục từng khoản phải được đặc tả theo chuẩn, không áp dụng máy móc “营业利润 + toàn bộ 财务费用”. Khi thiếu thuyết minh, các chỉ tiêu phụ thuộc bị thiếu, các chỉ tiêu khác vẫn có điểm.
3. **Thuê:** đề xuất pilot gồm nợ vay và nghĩa vụ finance lease đủ điều kiện; operating leases Mỹ và nghĩa vụ thuê Trung Quốc phải lưu thành phần riêng. Adapter CAS không tự coi mọi 租赁负债 là finance lease. Chỉ đưa phần có quy tắc phân loại kinh tế được duyệt vào tổng chấm; không phân loại được thì M04 thiếu. Mở rộng chính sách bao gồm mọi lease là một phiên bản phương pháp khác.
4. **Cash flow:** pilot giữ CFO theo chuẩn nguồn; không tự chuyển lãi vay giữa CFO/CFF. Nhãn kết quả nêu giới hạn so sánh. Một phiên bản so sánh xuyên quốc gia có thể điều chỉnh dòng tiền sau này, khi có thông tin lãi thực trả và chính sách riêng được duyệt.
5. **Làm tròn:** giữ số gốc, không sửa số để ép cân. Chỉ cho phép dung sai suy ra từ độ chính xác hiển thị và quy tắc làm tròn đã xác định. Ví dụ làm tròn gần nhất: |A−L−E| ≤ 0,5 × (qA+qL+qE), q là bước làm tròn theo tiền cơ sở. Không biết độ chính xác thì không tự cấp dung sai. Lưu residual và trạng thái “khớp trong sai số làm tròn”; quy tắc này chỉ áp dụng profile mới.

Cơ sở quan trọng: Bộ Tài chính Trung Quốc xác nhận cách trình bày cũ đưa một số khoản đầu tư/tài trợ vào 营业利润; bản sửa đổi 2026 bổ sung phân loại lợi nhuận mới và áp dụng theo lộ trình 2027/2029/2030 tùy nhóm doanh nghiệp, có thể áp dụng sớm. Vì thế không chọn mapping chỉ dựa vào năm. [Giải thích chính thức của MOF](https://ln.mof.gov.cn/lianzhengjianshe/202608/t20260811_3995236.htm).

Đối với lãi thực trả, US GAAP và CAS có cách phân loại dòng tiền cần phân biệt trong đánh giá tính so sánh. [FASB: ASC 230 trong ASU 2016-15](https://storage.fasb.org/ASU%202016-15.pdf), [MOF: CAS 31](https://kjs.mof.gov.cn/zt/kjzzss/kuaijizhunzeshishi/200806/t20080618_46250.htm).

**5. Kỳ báo cáo, đơn vị và tổng hợp nhiều năm**

- Hỗ trợ FY 12 tháng kết thúc ở tháng bất kỳ và FY 52/53 tuần có bằng chứng từ báo cáo. Lưu ngày bắt đầu/kết thúc thực tế và fiscal label; không tự đổi thành năm dương lịch.
- Nhãn “year ended” không đủ để bịa ngày bắt đầu của một kỳ chuyển đổi. Kỳ ngắn, kỳ chuyển đổi hoặc không rõ độ dài giữ riêng, không tự đóng góp vào bình quân FY.
- Balance sheet là số tại thời điểm; P&L/CFO/D&A là số trong khoảng thời gian. Không lấy hai cột balance sheet làm bằng chứng rằng đã có đủ hai năm P&L/CFO.
- Báo cáo quý, YTD, TTM có thể được lưu/hiển thị riêng theo khả năng đọc, nhưng không cộng thêm như một năm trong bình quân chính. Không nhân quý lên 4.
- Một file có số so sánh có thể cung cấp nhiều năm; mỗi năm chỉ có một bản được chọn. Upload thêm một file cùng năm không làm năm đó có thêm phiếu.
- So sánh nguyên bản/điều chỉnh lại phải theo cột và phiên bản thực sự. Sửa lỗi nhãn “Cột so sánh” đã phát hiện trong UAT trước, tránh xác định từ trích dẫn chứa cả hai tiêu đề.
- Chuẩn hóa chính xác USD thousands/millions, CNY 元/千元/万元/百万元/亿元 theo từng bảng hoặc số liệu. Không suy ra hệ số từ quốc gia hay áp một hệ số cho toàn bộ annual report.
- Giữ tiền tệ trình bày; tính tỷ số trong cùng phạm vi tiền tệ. Không đổi USD/CNY sang VND để tính điểm. Hồ sơ đổi tiền tệ, chuẩn hoặc cơ sở hợp nhất cần tách nhóm/giải quyết tương thích trước tổng hợp.
- Tỷ số không đổi khi chỉ thay hệ số hiển thị tương đương; điểm cũng phải bất biến. Báo cáo có nhiều loại đơn vị cần chuẩn hóa rồi mới đối chiếu.
- Năm 53 tuần được đánh dấu; có thể đóng góp FY theo policy đã duyệt, nhưng so sánh tăng trưởng với 52 tuần có cảnh báo và không tự chuẩn hóa ngày.
- Chỉ tổng hợp cùng doanh nghiệp và cơ sở đã chọn. Không cộng BCTC các công ty con VN/US/CN thành tập đoàn nếu không có báo cáo hợp nhất hoặc quy trình hợp nhất riêng.

Ví dụ: một chỉ tiêu tối đa 15 điểm có 2 năm đạt 9 và 12 điểm thì đóng góp 10,5/15. Năm trống không tham gia mẫu số bình quân. Chỉ tiêu khác tự có số năm hợp lệ của nó. Thêm dữ liệu có thể làm điểm tăng hoặc giảm; lợi ích là thêm chứng cứ và tăng độ đầy đủ.

SEC xác nhận niên độ doanh nghiệp có thể bắt đầu/kết thúc vào ngày/tháng khác nhau. Do đó không dùng calendar frames để tự chọn FY thay cho kỳ báo cáo thực tế. [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

**6. Nguồn vào và trải nghiệm người dùng**

Đợt đầu ưu tiên luồng đang có: PDF có text, PDF scan; XLS/XLSX và ảnh được đưa vào ma trận kiểm thử tương ứng, chỉ tuyên bố hỗ trợ định dạng sau khi nghiệm thu. Báo cáo scan không rõ số không được cố hoàn thiện bằng suy đoán.

Mỹ có thể tận dụng XBRL/iXBRL/SEC để giảm AI. Triển khai nguồn có cấu trúc sau khi luồng PDF và mô hình nguồn được chuẩn bị; không kéo việc crawl toàn thị trường vào phạm vi đầu tiên.

- SEC Company Facts là nguồn gợi ý/đối chiếu; chọn filing, accession, context, instant/duration, unit và kỳ cụ thể.
- API tổng hợp không bao phủ mọi custom tag hoặc thông tin phân chiều; thiếu phải quay lại filing và thuyết minh. Không lấy “fact mới nhất” cho mọi năm.
- Nếu một filing tồn tại cả PDF và XBRL thì phải liên kết và đối chiếu, không xem là hai lần đóng góp độc lập.
- Bằng chứng XBRL cần loại nguồn riêng: lưu tag, context, unit/decimals, accession, hash và vị trí trong tài liệu gốc. Không tạo số trang PDF giả.
- Dữ liệu công khai được tải có cache, giới hạn truy cập theo nguồn; không yêu cầu mua data feed cho đợt đầu.

[SEC mô tả phạm vi API XBRL](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [taxonomy được SEC chấp nhận](https://www.sec.gov/data-research/structured-data/taxonomies-schemas/standard-taxonomies/operating-companies).

Luồng UI sau tích hợp:

1. Tạo/chọn doanh nghiệp với quốc gia, ngành và định danh phù hợp. CIK/EIN hoặc mã đăng ký khi có chỉ hỗ trợ định danh; không dùng một tên giống nhau để tự gộp.
2. Tải tài liệu. Hiển thị quốc gia/chuẩn được nhận diện, cơ sở hợp nhất, kỳ và đơn vị. Không khớp hồ sơ thì giữ ngoài bộ dữ liệu chấm và yêu cầu giải quyết.
3. Xem số gốc và điều chỉnh cạnh nhau; mở đúng trang hoặc ô nguồn. Người dùng có thể xác nhận một phần mà vẫn biết phần còn thiếu.
4. Chọn nguồn khi trùng kỳ; giữ nguyên bản trước hoặc dùng bản mới. Chỉ phiên bản được chọn mới tính điểm.
5. Bấm chấm điểm: hiện điểm từng chỉ tiêu có dữ liệu, số năm đóng góp và tổng điểm tương ứng. Khi có đủ cả 7 mới hiện tổng đủ trọng số /100.
6. Bảng từng kỳ vẫn có thể N/A. Nhấn vào điểm mở công thức, dữ liệu, phép điều chỉnh và nguồn.
7. Kết quả US/CN hiển thị rõ phiên bản pilot và giới hạn so sánh. Không thêm cơ chế hỏi nhiều lần chỉ vì thiếu cột không bắt buộc.

**7. Hạng mục kỹ thuật và bảo toàn dữ liệu**

| Hạng mục | Thay đổi dự kiến |
|---|---|
| Contracts/schema | Profile kế toán, phiên bản trình bày, độ chính xác số, fiscal calendar, loại nguồn có cấu trúc, trạng thái hỗ trợ quốc gia; mở rộng tương thích với bản cũ. |
| Backend intake | Thay country gán cứng bằng scope từ doanh nghiệp và nguồn; kiểm tra lại trước ghi và trước xuất điểm; tách lỗi không hỗ trợ với sai doanh nghiệp/kỳ. |
| AI import | Dictionary/semantic checks theo profile; nhãn Anh/Trung; layout và column binding; chỉ tìm trang bổ sung cần thiết. |
| Normalization | Bộ đọc số và đơn vị theo tài liệu; số âm ngoặc, dấu trừ, ô trống, số 0 tường minh; xử lý từng bảng có đơn vị khác nhau. |
| Reasoning/calculation | Phép điều chỉnh có provenance; kiểm tra đủ thành phần, không trùng, không vòng lặp, không trộn kỳ/basis; số thiếu tiếp tục là thiếu. |
| Scoring/policy | Resolver chọn phương pháp đúng profile; country gate có điều kiện; profile US/CN thử nghiệm không dùng policy VN để vượt chặn. |
| Aggregation/trends | Hỗ trợ fiscal FY; bình quân điểm theo từng chỉ tiêu; một kỳ một nguồn; giữ cảnh báo khi không so sánh được. |
| UI | Mở US/CN theo capability backend; nhãn chuẩn/kỳ/tiền tệ; review điều chỉnh; lý do N/A; điểm và nguồn; nhãn cột so sánh chính xác. |
| Tài nguyên AI | Dedupe trước AI; checkpoint theo phiên bản và phạm vi quyền; quota, chi phí và log số lần gọi; resume có giới hạn. |

Cơ chế an toàn khi phát hành:

- Thay đổi schema theo hướng thêm trường/bảng, không ghi đè số gốc hoặc đổi nghĩa các fact cũ.
- Snapshot kết quả mới gắn phiên bản extractor/mapping/profile/scorer/aggregation và hash policy tương ứng. Thay công thức phải sinh kết quả mới, không sửa lịch sử.
- Phương pháp VN giữ nhánh tương thích. Cờ US/CN tắt thì dữ liệu/kết quả VN phải không thay đổi.
- Không tự xử lý lại toàn bộ khách hàng. Thử trước trên case UAT riêng và bật theo tổ chức/quốc gia.
- Cache/duplicate không lộ tài liệu giữa khách hàng. Khóa cache gồm hash, phiên bản xử lý và phạm vi truy cập; vẫn xác minh quyền đọc trước dùng lại.
- Rollback bằng tắt capability US/CN và quay về phiên bản phát hành trước; giữ lịch sử, không xóa dữ liệu đã nhập.
- Nếu phát hiện lỗi công thức mới, đánh dấu kết quả bị ảnh hưởng cần tính lại theo phiên bản mới, không âm thầm sửa điểm đã xuất.

**8. Kế hoạch triển khai theo thứ tự**

Ước lượng sơ bộ **18–23 ngày công kỹ thuật**, với người rà soát nghiệp vụ kế toán tham gia song song, nguồn mẫu sẵn có và không mở rộng sang mô hình tín dụng hiệu chỉnh. Đây là mức ước lượng để sắp xếp công việc, chưa là cam kết lịch.

| Giai đoạn | Công việc | Sản phẩm bàn giao/điều kiện qua bước | Ngày công |
|---|---|---|---|
| A. Chốt đặc tả | Khóa baseline VN; xác định phạm vi, 14 dữ liệu, bridge lợi nhuận, quick assets, lease, fiscal FY, rounding; chọn mẫu nguồn | Tài liệu nghiệp vụ, bảng mapping có phiên bản, danh sách mẫu và đáp án đối chiếu | 2 |
| B. Hợp đồng và profile | Capability resolver, contract/migration thêm trường, policy quốc gia, snapshot/version, identity/scope | Contract được kiểm thử; US/CN vẫn tắt; bản cũ đọc được | 3–4 |
| C. Mỹ | US GAAP adapter, PDF English, đơn vị, năm lệch/52–53 tuần, nguồn gộp cash, interest/debt/lease, partial scoring | Luồng PDF Mỹ chạy trên fixture; tỷ số và điểm khớp đáp án; chưa bật đại trà | 4–5 |
| D. Trung Quốc và UI | CAS theo phiên bản, từ điển Trung, đơn vị 元/万元/亿元, bridge và thuyết minh; UI review và lỗi trùng kỳ | Luồng CAS chạy trên fixture và UI; báo cáo khác chuẩn được giải thích rõ | 3–4 |
| E. UAT và hồi quy | Kiểm thử số học độc lập, nhiều nguồn/kỳ, tài liệu sai, bảo toàn VN; tối đa 6 hồ sơ AI trong ngân sách | Báo cáo UAT có ảnh UI, nguồn, phép tính và thống kê chi phí; lỗi chặn đã xử lý | 4–5 |
| F. Phát hành giới hạn | Bật theo quốc gia/tổ chức, kiểm tra log, hỗ trợ rollback, hoàn thiện hướng dẫn | Bản thử nghiệm được nghiệm thu và bật đúng phạm vi; kiểm tra rollback thành công | 2–3 |

Nguồn SEC/XBRL tự động là bước mở rộng tiếp theo sau sáu giai đoạn, dự kiến 3–5 ngày công bổ sung sau khảo sát parser và mô hình evidence. Không gộp vào mốc 18–23 ngày công. Việc hiệu chỉnh theo dữ liệu vỡ nợ/đối chứng thực tế là dự án phương pháp riêng và không thể hoàn tất bằng vài BCTC mẫu.

**9. Kiểm thử và tiêu chí nghiệm thu**

Bộ kiểm thử không phí gồm ít nhất 30 fixture quốc tế có đáp án độc lập, phân bổ US/CN, cùng toàn bộ bộ hồi quy VN phù hợp đã tồn tại. Fixture kỹ thuật tự xây dựng phải được ghi rõ; không gọi là bộ chuẩn độc lập/canonical của bên khác.

Các ca bắt buộc:

| Tình huống | Kết quả phải đạt |
|---|---|
| Một báo cáo đủ dữ liệu | Tính đủ 7 chỉ tiêu và tổng theo cấu hình pilot; truy vết được nguồn và phép tính. |
| Một báo cáo thiếu | Có điểm phần đủ, N/A phần thiếu, không ép đủ nhiều năm; không làm tròn thành tổng /100 giả. |
| Nhiều năm hợp lệ | Bình quân điểm mỗi chỉ tiêu đúng chính xác, trọng số một lần. |
| Một file chứa số so sánh | Nhận đúng năm và cột; mỗi kỳ chỉ đóng góp một lần. |
| Thêm quý hoặc kỳ trống | Không xóa điểm FY đã có, không xem là thêm một năm FY. |
| FY lệch lịch, 52/53 tuần | Dùng ngày thực; không bị loại chỉ vì không phải 31/12; kỳ chuyển đổi ngắn bị phân biệt. |
| USD thousand/million, CNY 元/万元/亿元 | Số cơ sở, tỷ số, điểm khớp; biểu diễn tương đương cho cùng kết quả. |
| Cash gộp, restricted cash | Không phải bịa cash/equivalents; không đếm trùng; thiếu chứng cứ thì M02 thiếu. |
| Net/gross interest, D&A lũy kế, Chinese profit | Không ánh xạ sai; bridge đầy đủ mới dùng, thiếu chỉ ảnh hưởng chỉ tiêu phụ thuộc. |
| Hợp nhất/riêng lẻ | Không ghép bảng công ty mẹ với bảng tập đoàn hoặc lấy equity không cùng phạm vi. |
| Nguồn gốc/điều chỉnh lại | Hiện xung đột cho người chọn; không ưu tiên bản tạo điểm đẹp hơn. |
| Upload trùng bytes/đổi tên | Không gọi AI mới và không tăng số kỳ đóng góp. |
| Sai doanh nghiệp/quốc gia/chuẩn; báo cáo thuế | Không đưa vào bộ số liệu chấm; thông báo đúng nguyên nhân; giữ các nguồn hợp lệ trước đó. |
| Làm tròn vs lệch thực | Chỉ chấp nhận sai số được suy ra và lưu trace; lệch vượt giới hạn không được che bằng tolerance tùy ý. |
| Đổi profile/công thức | Kết quả mới có phiên bản mới; kết quả cũ không bị viết lại hoặc tính lại ngầm. |
| Reload/re-score | Điểm và kỳ đóng góp ổn định; không gọi AI chỉ để tính lại. |
| Hết quota/AI timeout | Dừng có trạng thái rõ, giữ checkpoint hợp lệ, không lặp tốn phí không giới hạn. |
| Hồi quy VN | Giá trị fact, tỷ số, điểm, nguồn và quyết định giữ/thay trước đó không thay đổi khi input/policy không đổi. |

Nguồn mẫu công khai đề xuất: [TD SYNNEX FY2025, SEC 10-K](https://www.sec.gov/Archives/edgar/data/1177394/000162828026003598/snx-20251130.htm) cho phân phối và niên độ kết thúc 30/11; [Digital China Group FY2025 trên CNINFO](https://static.cninfo.com.cn/finalpage/2026-03-31/1225058636.PDF) cho báo cáo Trung Quốc có hợp nhất/công ty mẹ và thuyết minh. Đây là ứng viên bộ mẫu, chưa phải kết quả UAT của ứng dụng. Bổ sung doanh nghiệp/niên độ khác để không học theo một layout.

Điều kiện đạt:

- 100% đầu vào thực sự dùng tính điểm trong bộ nghiệm thu được đối chiếu đúng con số, dấu, đơn vị, cột/kỳ và phạm vi. Sai số nghiêm trọng chưa giải quyết thì không được đưa vào điểm.
- Tỷ số, điểm từng năm, bình quân từng chỉ tiêu và tổng khớp bộ tính độc lập; tính chính xác trước, chỉ làm tròn khi hiển thị.
- 100% ca chống trộn kỳ/đơn vị/basis, nguồn trùng và sai hồ sơ trong bộ bắt buộc đạt.
- Bộ hồi quy VN đạt; đối chiếu snapshot trên case kiểm thử đã có, không phải chỉ kiểm tra app build được.
- Người dùng hoàn thành luồng một/nhiều/sai báo cáo trực tiếp trên UI và xem được vì sao một phần N/A.
- Tổng usage và chi phí AI trong giới hạn; không có API call từ reload hoặc chấm lại.
- Nghiệm thu số học không được mô tả thành đã chứng minh dự báo tín dụng/PD chính xác.

**10. Kiểm soát DeepSeek**

1. Đọc text/bảng cục bộ trước; chỉ OCR cục bộ trang thiếu text sau khi xác nhận bộ ngôn ngữ có sẵn. Không tự cài hoặc gọi dịch vụ OCR trả phí như fallback không báo trước.
2. Chọn bảng cân đối, kết quả kinh doanh, dòng tiền và thuyết minh cần thiết; không gửi toàn bộ annual report hàng trăm trang vào model.
3. Dedupe và kiểm tra định dạng/kích thước/đọc được file trước mọi bước AI có thể tránh được. Sai tài liệu chỉ biết sau nhận diện thì ghi nhận chi phí nhận diện, không hứa 0 phí.
4. Lưu kết quả từng giai đoạn đã qua kiểm chứng theo hash và phiên bản. Dùng replay cho kiểm thử mapping, công thức, UI và hồi quy.
5. Hạn mức theo mỗi hồ sơ và cả đợt UAT; dành trước chi phí tối đa của request trước khi gửi, tính cả các bước chạy song song và repair. Không tự retry khi hết trần.
6. Đọc usage token, số request, cache hit và lỗi từ provider; phân biệt usage thực với ước lượng khi provider không trả đủ. Không quy số file thành số request.
7. Trần 2 USD cần cấu hình giá đúng model/provider đang sử dụng và có ngày kiểm tra; không có bảng giá tin cậy thì chạy replay trước, chưa chạy paid UAT.
8. Sau khi có quota, dùng tối đa 6 tài liệu mới, dự kiến 3 Mỹ và 3 Trung Quốc bao phủ một/nhiều/sai. Các ca đổi tên, tải trùng, tính lại và thay đơn vị thử bằng fixture/replay để tiết kiệm. Đây là giới hạn, không phải mục tiêu phải dùng hết.

**11. Phần đề nghị duyệt để bắt đầu triển khai**

Duyệt phạm vi US GAAP + CAS cho doanh nghiệp phân phối/bán buôn; phương pháp pilot có phiên bản riêng với trọng số hiện tại; quy tắc thiếu dữ liệu và bình quân năm đã nêu; các chính sách kế toán ở mục 4; bảo toàn VN; UAT trực tiếp UI và trần AI tối đa 2 USD/6 hồ sơ mới.

Bản duyệt này cho phép xây dựng và kiểm thử phiên bản pilot trong phạm vi trên. Việc đưa ra tuyên bố điểm tín dụng đã hiệu chỉnh hay PD cần dữ liệu và phê duyệt phương pháp riêng. Hiện tại mới hoàn tất khảo sát và kế hoạch, chưa đổi code ứng dụng, cấu hình quốc gia, dữ liệu khách hàng hoặc gọi AI trả phí.
