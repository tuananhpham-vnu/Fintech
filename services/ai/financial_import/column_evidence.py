"""Ground two-period rows in their own page/statement headers, never another page.

Headerless continuation tables require review. Single-value prose still passes
through the existing quotation, token, scope and human-verification checks.
"""
import re
from decimal import Decimal
from .semantics import text

_SECTION = re.compile(
    r"bang can doi|bao cao (?:ket qua|luu chuyen|tinh hinh tai chinh)"
    r"|balance sheets?|statements? of (?:income|operations|cash flows?|financial position)"
)
_REPORT_HEADING = re.compile(
    r"tai ngay \d{1,2} thang \d{1,2} nam|ky tinh thue:\s*nam"
    r"|for (?:the )?year ended"
)
_HEADER = re.compile(r"^(?:chi tieu|ma so?|items?|description|particulars|account)(?:\s|$)")
_CURRENT = {"nam nay", "nam hien tai", "so cuoi nam", "current year"}
_PRIOR = {"nam truoc", "so dau nam", "previous year", "prior year"}


def _column(cell, year):
    if cell in _CURRENT:
        return year
    if cell in _PRIOR:
        return year - 1 if year is not None else None
    match = re.fullmatch(r"(?:nam\s+)?(20\d{2})", cell)
    return int(match[1]) if match else None


def _table_rows(source, label, country):
    from .service import token_value
    year, columns, width = None, None, None
    for line in source.splitlines():
        normalized = text(line)
        section = _SECTION.search(normalized)
        if section:
            year, columns, width = None, None, None
        if section or _REPORT_HEADING.search(normalized):
            years = set(re.findall(r"\b20\d{2}\b", normalized))
            year = int(next(iter(years))) if len(years) == 1 else None
            columns, width = None, None
        if '|' not in line:
            continue
        cells = [cell.strip() for cell in line.strip().split('|')]
        # Remove only Markdown's optional outer delimiters, not empty data cells.
        if not cells[0]:
            cells.pop(0)
        if cells and not cells[-1]:
            cells.pop()
        if not cells:
            continue
        folded = [text(cell) for cell in cells]
        named_roles = _CURRENT | _PRIOR
        is_header = (bool(_HEADER.match(folded[0])) or any(c in named_roles for c in folded)
                     or all(re.fullmatch(r"(?:nam\s+)?20\d{2}", c) for c in folded))
        if is_header:
            width = len(cells)
            mapped = [_column(c, year) for c in folded]
            # Never ignore a third period or an unknown/repeated final column.
            columns = (mapped[-2:] if len(mapped) >= 2 and
                       sum(v is not None for v in mapped) == 2 and
                       None not in mapped[-2:] and mapped[-2] != mapped[-1] else None)
            continue
        if label not in normalized:
            continue
        numeric = [token_value(cell, country) for cell in cells]
        if columns is not None and (len(cells) != width or None in numeric[-2:]):
            yield None, ()
            continue
        # Do not mistake a note/row code for a value: both final cells must be amounts.
        if len(numeric) >= 2 and all(v is not None for v in numeric[-2:]):
            yield columns, numeric[-2:]


def column_issue(component, scope, pages, variable=None):
    page = pages.get(component['page'])
    if not page:return None
    requested_year=int(scope['end_date'][:4])
    if variable and variable['nature']=='instant':
        requested_year=int(variable['as_of'][:4])
        if variable['as_of']==scope['start_date']:requested_year-=1
    label=text(component['label'])
    if variable and re.search(r'dau ky|dau nam|beginning|opening',label):
        from datetime import date,timedelta
        prior=(date.fromisoformat(scope['start_date'])-timedelta(days=1)).isoformat()
        if variable['nature']=='instant' and variable['as_of'] not in (scope['start_date'],prior):return 'SOURCE_COLUMN_NOT_AVAILABLE'
        # Cash-flow opening-balance rows have one opening amount per YEAR column;
        # their first column is the current year's opening, not its closing balance.
        requested_year=int(scope['end_date'][:4])
    rows = list(_table_rows(page['text'], label, scope['country']))
    if not rows:
        return None
    if any(columns is None for columns, _ in rows):
        return 'SOURCE_COLUMN_AMBIGUOUS'
    if any(requested_year not in columns for columns, _ in rows):
        return 'SOURCE_COLUMN_NOT_AVAILABLE'
    expected = {values[columns.index(requested_year)] for columns, values in rows}
    # A repeated label in distinct tables cannot be resolved by selecting whichever
    # occurrence happens to agree with the model's proposed number.
    if len(expected) != 1:
        return 'SOURCE_COLUMN_AMBIGUOUS'
    if Decimal(component['value']) not in expected:
        return 'SOURCE_COLUMN_MISMATCH'
    return None
