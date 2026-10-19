import pytest
from financial_import.periods import calendar_start, normalize_period


@pytest.mark.parametrize('kind,end,label,start', [
    ('FY','2025-12-31','Báo cáo tài chính năm 2025','2025-01-01'),
    ('FY','2025-12-31','Năm tài chính 2025','2025-01-01'),
    ('FY','2025-12-31','Năm tài chính kết thúc ngày 31/12/2025','2025-01-01'),
    ('INTERIM','2026-03-31','Quý I năm 2026','2026-01-01'),
    ('INTERIM','2026-06-30','Quý II năm 2026','2026-04-01'),
    ('INTERIM','2026-06-30','Lũy kế 6 tháng năm 2026','2026-01-01'),
    ('INTERIM','2024-02-29','Tháng 2 năm 2024','2024-02-01'),
    ('INTERIM','2025-02-28','Tháng 2 năm 2025','2025-02-01'),
    ('INTERIM','2025-02-28','Tháng 02 năm 2025','2025-02-01'),
    ('INTERIM','2026-09-30','Lũy kế 6 tháng năm 2026',None),
    ('INTERIM','2026-06-30','Quý II và lũy kế 6 tháng năm 2026',None),
    ('INTERIM','2026-06-30','Tại ngày 30/06/2026',None),
    ('FY','2025-06-30','Năm tài chính 2025',None),
    ('FY','2025-12-31','Kỳ đầu năm 2025',None),
    ('TTM','2025-12-31','Năm 2025',None),
])
def test_only_evidenced_unambiguous_calendar_periods_are_normalized(kind,end,label,start):
    assert calendar_start(kind,end,label) == start


def test_explicit_shifted_start_is_preserved():
    period = dict(kind='FY',start_date='2025-04-01',end_date='2026-03-31',evidence=[])
    assert normalize_period(period) == period
