"""Calendar boundaries derived from an evidenced period label, never a filename."""
import calendar
import re
import unicodedata
from datetime import date, timedelta


def calendar_start(kind, end_date, evidence):
    end = date.fromisoformat(end_date)
    label = ''.join(c for c in unicodedata.normalize('NFD', evidence.lower())
                    if not unicodedata.combining(c)).replace('đ', 'd')
    label = re.sub(r'\s+', ' ', label)
    if kind == 'FY' and str(end.year) in label:
        # Chinese annual headings are accounting-period evidence, not signature dates.
        if (end.month,end.day)==(12,31) and re.search(rf'{end.year}\s*年\s*(?:度|年度)',label):
            return f'{end.year}-01-01'
        months = ['january','february','march','april','may','june','july','august','september','october','november','december']
        printed_end = bool(re.search(rf'{months[end.month-1]}\s+0?{end.day}(?:\s*,)?\s*(?:{end.year}|,?\s*20\d{{2}}(?:\s*,?\s*20\d{{2}})*\s*{end.year})',label))
        weeks = re.search(r'\b(52|53)[ -]weeks?(?:\s+fiscal\s+year)?\s+ended',label)
        if weeks and printed_end:
            return (end-timedelta(days=int(weeks.group(1))*7-1)).isoformat()
        if printed_end and re.search(r'\b(?:fiscal\s+)?years?\s+ended\b',label) and not re.search(r'52[ -]week|53[ -]week|short.year|transition',label):
            # A year-ended label establishes an ordinary annual interval; an explicit
            # weeks-based or transition label never takes this path.
            next_day=end+timedelta(days=1)
            try:return next_day.replace(year=next_day.year-1).isoformat()
            except ValueError:return None
    if str(end.year) not in label or re.search(r'52.week|53.week|short.year|ky dau|nien do khac', label):
        return None
    if kind == 'FY' and (end.month, end.day) == (12, 31) and re.search(
            rf'\bnam(?: tai chinh)?\s+{end.year}\b|\byear\s+{end.year}\b|\b(?:nam tai chinh|nien do|year)\s+(?:ket thuc|ended)', label):
        return f'{end.year}-01-01'
    if kind != 'INTERIM' or end.day != calendar.monthrange(end.year, end.month)[1]:
        return None
    quarter = re.search(r'\b(?:quy|quarter)\s*(iv|iii|ii|i|[1-4])\b|\bq([1-4])\b', label)
    ytd = re.search(r'luy ke|year.to.date|six months ended|nine months ended|sau thang|chin thang|6 thang|9 thang', label)
    if quarter and ytd:
        return None
    if ytd and end.month in (3, 6, 9, 12):
        # A six-month label cannot justify a nine-month end date, even if the
        # model also returned a generic YTD label.
        duration = re.search(r'\b(6|9) thang\b|\b(six|nine|sau|chin) (?:months|thang)\b', label)
        if duration:
            months = int(duration.group(1)) if duration.group(1) else {'six': 6, 'sau': 6, 'nine': 9, 'chin': 9}[duration.group(2)]
            if months != end.month:
                return None
        return f'{end.year}-01-01'
    if quarter:
        q = quarter.group(1) or quarter.group(2)
        q = {'i': 1, 'ii': 2, 'iii': 3, 'iv': 4}.get(q, int(q) if q.isdigit() else 0)
        if end.month == q * 3:
            return f'{end.year}-{q * 3 - 2:02d}-01'
    month = re.search(r'\b(?:thang|month)\s*(1[0-2]|0?[1-9])\b', label)
    if month and int(month.group(1)) == end.month and not quarter and not ytd:
        return f'{end.year}-{end.month:02d}-01'
    return None


def normalize_period(period):
    if period['start_date'] is None:
        start = calendar_start(period['kind'], period['end_date'],
                               ' '.join(e['quote'] for e in period['evidence']))
        if start:
            return {**period, 'start_date': start}
    return period
