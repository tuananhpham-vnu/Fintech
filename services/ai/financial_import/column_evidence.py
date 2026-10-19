"""Check known two-period table columns independently of a model's year assertion.

Unknown layouts remain under human review; this guard never invents a column.
"""
import re
from decimal import Decimal
from .semantics import text

def column_issue(component, scope, pages, variable=None):
    from .service import token_value
    page = pages.get(component['page'])
    if not page:return None
    source = page['text']
    headings = '\n'.join(p['text'][:10000] for p in pages.values())
    normalized = text(headings)
    years = re.findall(r'(?:tai ngay \d{1,2} thang \d{1,2} nam|ky tinh thue:\s*nam|for (?:the )?year ended[^\n]{0,30}?)\s*(20\d{2})', normalized)
    if not years:return None
    report_year=max(map(int,years))
    requested_year=int(scope['end_date'][:4])
    if variable and variable['nature']=='instant':
        requested_year=int(variable['as_of'][:4])
        if variable['as_of']==scope['start_date']:requested_year-=1
    comparative=bool(re.search(r'so dau nam|nam truoc|previous year|prior year',normalized))
    if not comparative:return None
    label=text(component['label'])
    if variable and re.search(r'dau ky|dau nam|beginning|opening',label):
        from datetime import date,timedelta
        prior=(date.fromisoformat(scope['start_date'])-timedelta(days=1)).isoformat()
        if variable['nature']=='instant' and variable['as_of'] not in (scope['start_date'],prior):return 'SOURCE_COLUMN_NOT_AVAILABLE'
        # Cash-flow opening-balance rows have one opening amount per YEAR column;
        # their first column is the current year's opening, not its closing balance.
        requested_year=int(scope['end_date'][:4])
    rows=[line for line in source.splitlines() if '|' in line and label in text(line)]
    matches=[]
    for row in rows:
        cells=[cell.strip() for cell in row.split('|')]
        numeric=[token_value(cell,scope['country']) for cell in cells]
        # The last two cells must themselves contain amounts. Never take a row code
        # or note reference from earlier columns as a financial amount.
        while cells and not cells[-1]:cells.pop();numeric.pop()
        if len(numeric)<2 or numeric[-1] is None or numeric[-2] is None:continue
        if requested_year not in (report_year,report_year-1):return 'SOURCE_COLUMN_NOT_AVAILABLE'
        expected=numeric[-2] if requested_year==report_year else numeric[-1]
        matches.append(expected==Decimal(component['value']))
    if matches and not any(matches):return 'SOURCE_COLUMN_MISMATCH'
    return None
