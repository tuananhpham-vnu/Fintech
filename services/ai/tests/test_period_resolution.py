import copy
import pytest
from financial_import.period_resolution import resolve_periods
from financial_import.service import source_quote


def period(year, quote=None):
    return dict(kind='FY',start_date=f'{year}-01-01',end_date=f'{year}-12-31',basis='standalone',pages=[1],
                evidence=[dict(page=1,quote=quote or f'Year {year}')])


def resolve(candidates, text):
    return resolve_periods(candidates,{1:{'text':text}},source_quote)


def test_previous_year_needs_current_year_heading_and_actual_income_column():
    text='INCOME STATEMENT\nYear 2025\nCurrent year | Previous year\nNet revenue | 200 | 100'
    current, prior = period(2025),period(2024,'Previous year')
    accepted,issues=resolve([prior,current],text)
    assert {p['end_date'] for p in accepted}=={'2024-12-31','2025-12-31'}
    assert not issues
    prior=next(p for p in accepted if p['end_date']=='2024-12-31')
    assert prior['evidence']==[{'page':1,'quote':'Year 2025'},{'page':1,'quote':'Previous year'}]


def test_vietnamese_comparative_year_is_contextual_not_an_invented_quote():
    text='BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH\nKỳ tính thuế: Năm 2024\nNăm nay | Năm trước'
    accepted,issues=resolve([period(2024,'Kỳ tính thuế: Năm 2024'),period(2023,'Năm trước')],text)
    assert len(accepted)==2 and not issues
    assert all(source_quote(text,e['quote']) for p in accepted for e in p['evidence'])


@pytest.mark.parametrize('header', ['BALANCE SHEET','INCOME STATEMENT short year','INCOME STATEMENT 52-week'])
def test_opening_balances_or_nonstandard_years_do_not_manufacture_prior_annual_data(header):
    text=header+'\n2024-01-01 to 2024-12-31\nPrevious year'
    current=period(2024,'2024-01-01 to 2024-12-31')
    accepted,issues=resolve([current,period(2023,'Previous year')],text)
    assert len(accepted)==1 and issues[0]['code']=='PERIOD_CONTEXT_REQUIRED'


def test_shifted_fiscal_year_comparative_is_not_calendar_inferred():
    current=period(2025,'2024-04-01 to 2025-03-31');current.update(start_date='2024-04-01',end_date='2025-03-31')
    prior=period(2024,'Previous year');prior.update(start_date='2023-04-01',end_date='2024-03-31')
    accepted,issues=resolve([current,prior],'INCOME STATEMENT\n2024-04-01 to 2025-03-31\nPrevious year')
    assert len(accepted)==1 and issues[0]['end_date']=='2024-03-31'


def test_signature_year_does_not_create_a_reporting_period():
    accepted,issues=resolve([period(2025),period(2026,'Lập, ngày 28 tháng 03 năm 2026')],
                            'INCOME STATEMENT\nYear 2025\nLập, ngày 28 tháng 03 năm 2026')
    assert len(accepted)==1 and issues[0]['code']=='NON_REPORTING_DATE_IGNORED'
    assert issues[0]['severity']=='info'


def test_duplicate_periods_merge_without_a_blocking_warning():
    accepted,issues=resolve([period(2025),period(2025)],'INCOME STATEMENT\nYear 2025')
    assert len(accepted)==1 and issues[0]['code']=='DUPLICATE_MERGED' and issues[0]['severity']=='info'


def test_a_fabricated_additional_quote_is_not_kept_as_source_evidence():
    raw=period(2025);raw['evidence'].append({'page':1,'quote':'private invented source'})
    accepted,issues=resolve([raw],'INCOME STATEMENT\nYear 2025')
    assert len(accepted)==1 and len(accepted[0]['evidence'])==1
    assert issues[0]['code']=='EXTRA_QUOTE_REJECTED' and issues[0]['severity']=='info'


def test_incorrect_start_is_not_silently_normalized():
    raw=period(2025);raw['start_date']='2025-04-01'
    accepted,issues=resolve([raw],'INCOME STATEMENT\nYear 2025')
    assert not accepted and issues[0]['code']=='PERIOD_CONTEXT_REQUIRED'
