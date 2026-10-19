from financial_import.column_evidence import column_issue

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
