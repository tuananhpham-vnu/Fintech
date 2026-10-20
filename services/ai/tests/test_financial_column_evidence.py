from financial_import.column_evidence import column_issue
import pytest

SCOPE={'country':'VN','start_date':'2023-01-01','end_date':'2023-12-31'}
PAGES={1:{'text':'Tại ngày 31 tháng 12 năm 2024\nChỉ tiêu | Mã | Số cuối năm | Số đầu năm\nVay ngắn hạn | 320 | 38.766.682.010 | 5.653.171.207'}}
def component(value):return dict(page=1,label='Vay ngắn hạn',value=value)

def test_wrong_comparative_column_cannot_be_relabelled_as_requested_year():
    assert column_issue(component('38766682010'),SCOPE,PAGES)=='SOURCE_COLUMN_MISMATCH'
    assert column_issue(component('5653171207'),SCOPE,PAGES) is None

def test_current_column_is_independently_checked_too():
    scope={**SCOPE,'start_date':'2024-01-01','end_date':'2024-12-31'}
    assert column_issue(component('5653171207'),scope,PAGES)=='SOURCE_COLUMN_MISMATCH'
    assert column_issue(component('38766682010'),scope,PAGES) is None

def test_unavailable_older_period_is_not_made_from_existing_columns():
    scope={**SCOPE,'start_date':'2022-01-01','end_date':'2022-12-31'}
    assert column_issue(component('5653171207'),scope,PAGES)=='SOURCE_COLUMN_NOT_AVAILABLE'

def test_opening_role_selects_previous_balance_without_swapping_closing_targets():
    scope={**SCOPE,'start_date':'2024-01-01','end_date':'2024-12-31'}
    variable=dict(nature='instant',as_of='2024-01-01')
    assert column_issue(component('5653171207'),scope,PAGES,variable) is None

def test_unknown_layout_is_not_given_an_invented_column_mapping():
    assert column_issue(component('1'),SCOPE,{1:{'text':'Vay ngắn hạn 1'}}) is None

def test_cash_flow_opening_row_uses_the_period_column_with_the_opening_stock_role():
    pages={1:{'text':PAGES[1]['text']+'\nTiền đầu kỳ | 60 | 993 | 467'}}
    scope={**SCOPE,'start_date':'2024-01-01','end_date':'2024-12-31'}
    observation=dict(page=1,label='Tiền đầu kỳ',value='993')
    assert column_issue(observation,scope,pages,dict(nature='instant',as_of='2024-01-01')) is None
    assert column_issue(observation,scope,pages,dict(nature='instant',as_of='2024-12-31'))=='SOURCE_COLUMN_NOT_AVAILABLE'


def statement(year, row='Doanh thu thuần | 10 | 100 | 80'):
    return {'text': f'BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH\n'
            f'Kỳ tính thuế: Năm {year}\nChỉ tiêu | Mã | Năm nay | Năm trước\n{row}'}


@pytest.mark.parametrize('year,value,expected', [
    (2023, '100', None), (2023, '80', 'SOURCE_COLUMN_MISMATCH'),
    (2022, '80', None), (2022, '100', 'SOURCE_COLUMN_MISMATCH'),
])
@pytest.mark.parametrize('extra_page', [0, 2, 10])
def test_source_year_mapping_is_independent_of_unrelated_pages(year, value, expected, extra_page):
    pages = {1: statement(2023)}
    if extra_page:
        pages[extra_page] = statement(2024, 'Tổng tài sản | 270 | 300 | 200')
    scope = {**SCOPE, 'start_date': f'{year}-01-01', 'end_date': f'{year}-12-31'}
    assert column_issue(dict(page=1, label='Doanh thu thuần', value=value), scope, pages) == expected


def test_later_statement_on_same_page_does_not_relabel_earlier_table():
    pages = {1: {'text': statement(2023)['text'] + '\n' + statement(2024)['text']}}
    fact = dict(page=1, label='Doanh thu thuần', value='100')
    # The short quotation cannot distinguish two different annual tables.
    assert column_issue(fact, SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'
    pages[1]['text'] = statement(2023)['text'] + '\n' + statement(2024, 'Lợi nhuận | 60 | 30 | 20')['text']
    assert column_issue(fact, SCOPE, pages) is None


def test_new_statement_without_year_cannot_inherit_preceding_statement_year():
    pages = {1: {'text': statement(2024)['text'] +
                '\nBÁO CÁO LƯU CHUYỂN TIỀN TỆ\nChỉ tiêu | Mã | Năm nay | Năm trước\n'
                'Lưu chuyển tiền thuần | 20 | 50 | 40'}}
    assert column_issue(dict(page=1, label='Lưu chuyển tiền thuần', value='40'),
                        SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'


@pytest.mark.parametrize('header,year,value', [
    ('Năm nay | Năm trước', 2023, '100'),
    ('Năm trước | Năm nay', 2023, '80'),
    ('Năm 2023 | Năm 2022', 2022, '80'),
    ('2022 | 2023', 2022, '100'),
])
def test_column_order_comes_from_local_header(header, year, value):
    pages = {1: {'text': 'Kỳ tính thuế: Năm 2023\nChỉ tiêu | Mã | ' + header +
                        '\nDoanh thu thuần | 10 | 100 | 80'}}
    scope = {**SCOPE, 'end_date': f'{year}-12-31', 'start_date': f'{year}-01-01'}
    assert column_issue(dict(page=1, label='Doanh thu thuần', value=value), scope, pages) is None


@pytest.mark.parametrize('prefix', [
    '', 'Kỳ tính thuế: Năm 2023\n',
    'Kỳ tính thuế: Năm 2023 và Năm 2024\nChỉ tiêu | Mã | Năm nay | Năm trước\n',
    'Kỳ tính thuế: Năm 2023\nChỉ tiêu | Mã | Năm nay | Năm nay\n',
])
def test_ambiguous_two_column_rows_fail_closed(prefix):
    pages = {1: {'text': prefix + 'Doanh thu thuần | 10 | 100 | 80'}, 2: statement(2024)}
    assert column_issue(dict(page=1, label='Doanh thu thuần', value='100'),
                        SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'


def test_vietnamese_multipage_statement_uses_repeated_local_headings():
    pages = {1: statement(2023), 2: statement(2023, 'Lợi nhuận | 60 | 30 | 20'),
             3: statement(2024)}
    assert column_issue(dict(page=2, label='Lợi nhuận', value='30'), SCOPE, pages) is None
    assert column_issue(dict(page=2, label='Lợi nhuận', value='20'), SCOPE, pages) == 'SOURCE_COLUMN_MISMATCH'
    # A headerless continuation needs source review, not a guessed inherited year.
    pages[2]['text'] = 'BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH (tiếp theo)\nLợi nhuận | 60 | 30 | 20'
    assert column_issue(dict(page=2, label='Lợi nhuận', value='30'), SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'


def test_direct_fact_grounding_uses_local_column_and_preserves_quote_checks():
    from financial_import.service import grounded_fact
    scope = {**SCOPE, 'basis': 'standalone', 'currency': 'VND', 'unit_multiplier': '1'}
    pages = {1: statement(2023), 2: statement(2024)}
    fact = dict(page=1, key='net_revenue', label='Doanh thu thuần', value='100', raw_token='100',
                quote='Doanh thu thuần | 10 | 100 | 80', period_end=SCOPE['end_date'], basis='standalone')
    assert grounded_fact(fact, scope, pages) is None
    assert grounded_fact({**fact, 'value': '80', 'raw_token': '80'}, scope, pages) == 'SOURCE_COLUMN_MISMATCH'
    assert grounded_fact({**fact, 'quote': 'Invented quote'}, scope, pages) == 'QUOTE_NOT_IN_SOURCE'


@pytest.mark.parametrize('cached', [False, True])
@pytest.mark.parametrize('value', ['100', '80'])
def test_reasoning_rechecks_fresh_and_cached_observations(monkeypatch, cached, value):
    import copy
    from financial_import.reasoning import build
    from financial_import import checkpoint
    from extraction.llm import Deadline
    from .test_extraction import FakeModel
    scope = {**SCOPE, 'basis': 'standalone', 'currency': 'VND', 'unit_multiplier': '1'}
    pages = {1: {**statement(2023), 'page': 1}, 2: {**statement(2024), 'page': 2}}
    quote = 'Doanh thu thuần | 10 | 100 | 80'
    observed = dict(
        variables=[dict(id='revenue', key='net_revenue', label='Doanh thu thuần',
                        dimension='money', nature='duration', as_of=None)],
        observations=[dict(id='source', variable_id='revenue', label='Doanh thu thuần',
                           value=value, raw_token=value, page=1, quote=quote,
                           period_start=scope['start_date'], period_end=scope['end_date'],
                           basis='standalone', currency='VND', unit_multiplier='1', dimension='money')])
    monkeypatch.setattr(checkpoint, 'get', lambda _: copy.deepcopy(observed) if cached else None)
    monkeypatch.setattr(checkpoint, 'put', lambda *_: None)
    plan = dict(variables=[], relations=[], requested_pages=[])
    model = FakeModel(*([plan] if cached else [observed, plan]))
    result = build(model, scope, pages, [], Deadline(30))
    if value == '100':
        assert len(result['observations']) == 1
        assert result['observations'][0]['quote'] == quote
        assert result['observations'][0]['value'] == '100'
    else:
        assert not result['observations']
        assert any(d['code'] == 'SOURCE_COLUMN_MISMATCH' for d in result['diagnostics'])


def test_third_or_unrecognized_column_does_not_inherit_previous_mapping():
    prefix = statement(2023)['text']
    for header in ('Chỉ tiêu | 2023 | 2022 | 2021', 'Chỉ tiêu | Kế hoạch | Thực tế'):
        pages = {1: {'text': prefix + '\n' + header + '\nLợi nhuận | 90 | 30 | 20'}}
        assert column_issue(dict(page=1, label='Lợi nhuận', value='30'),
                            SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'


def test_english_report_uses_its_own_heading():
    pages = {1: {'text': 'For the year ended December 31, 2023\n'
                        'Description | Current year | Previous year\nNet revenue | 100 | 80'},
             2: {'text': 'For the year ended December 31, 2024'}}
    assert column_issue(dict(page=1, label='Net revenue', value='100'), SCOPE, pages) is None
    assert column_issue(dict(page=1, label='Net revenue', value='80'), SCOPE, pages) == 'SOURCE_COLUMN_MISMATCH'


@pytest.mark.parametrize('row', [
    'Doanh thu thuần | 10 | 100 |',
    '| Doanh thu thuần | 10 | 100 | |',
    'Doanh thu thuần | 10 | 100 | —',
    'Doanh thu thuần | 10 | 90 | 100 | 80',
])
def test_missing_or_extra_cells_cannot_shift_a_row_code_into_an_amount_column(row):
    pages = {1: statement(2023, row)}
    assert column_issue(dict(page=1, label='Doanh thu thuần', value='100'),
                        SCOPE, pages) == 'SOURCE_COLUMN_AMBIGUOUS'


def test_markdown_outer_delimiters_preserve_valid_mapping():
    pages = {1: {'text': 'Kỳ tính thuế: Năm 2023\n| Chỉ tiêu | Mã | Năm nay | Năm trước |\n'
                        '| --- | --- | --- | --- |\n| Doanh thu thuần | 10 | 100 | 80 |'}}
    assert column_issue(dict(page=1, label='Doanh thu thuần', value='100'), SCOPE, pages) is None
