"""Ground reporting periods and comparative columns; signature dates never create a period."""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from .periods import calendar_start


def folded(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower())
                   if not unicodedata.combining(c)).replace('đ', 'd')


def _source_label(text, pattern):
    chars, offsets = [], []
    for i, char in enumerate(text):
        part = folded(char)
        chars.extend(part); offsets.extend([i] * len(part))
    match = re.search(pattern, ''.join(chars), re.I)
    return text[offsets[match.start()]:offsets[match.end()-1]+1] if match else None


def _signature(text, quote):
    pos = text.find(quote)
    line = text[max(0,text.rfind('\n',0,pos)+1):text.find('\n',pos+len(quote)) if '\n' in text[pos+len(quote):] else len(text)]
    label = folded(line)
    return bool(re.search(r'\blap\b.*\bngay\b|ngay ky|signed|prepared on', label) and
                not re.search(r'tai ngay|ky tinh thue|nam tai chinh|reporting period', label))


def _explicit(period, evidence):
    """A full date range or a reporting label, not just any matching year number."""
    end = date.fromisoformat(period['end_date'])
    label = folded(' '.join(e['quote'] for e in evidence))
    start = period['start_date']
    if start and start in label and end.isoformat() in label:
        return start
    if period['kind'] == 'FY' and 'tai ngay' in label and not re.search(
            r'ky tinh thue|nam tai chinh|nien do|bao cao|\byear ended\b',label):
        return None
    inferred = calendar_start(period['kind'],period['end_date'],label)
    if inferred:
        return inferred if start in (None,inferred) else None
    # Preserve explicitly printed shifted financial years/date ranges.
    if start:
        begin = date.fromisoformat(start)
        def printed(d):
            months=['january','february','march','april','may','june','july','august','september','october','november','december']
            return d.isoformat() in label or bool(re.search(rf'\b0?{d.day}[/.\-]0?{d.month}[/.\-]{d.year}\b|{d.year}\s*年\s*0?{d.month}\s*月\s*0?{d.day}\s*日|{months[d.month-1]}\s+0?{d.day},?\s+{d.year}',label))
        if printed(begin) and printed(end):
            return start
    return None


def resolve_periods(candidates, pages, quote_match):
    accepted, issues, pending = [], [], []

    def issue(index, period, code, severity='blocking'):
        try:
            end = date.fromisoformat(period['end_date']).isoformat()
        except (ValueError,TypeError):
            end = None
        issues.append(dict(candidate_index=index,kind=period['kind'],end_date=end,basis=period['basis'],
                           pages=sorted({p for p in period['pages'] if 1 <= p <= 600}),code=code,severity=severity))

    def accept(index, period):
        identity = tuple(period[k] for k in ('kind','start_date','end_date','basis'))
        existing = next((p for p in accepted if tuple(p[k] for k in ('kind','start_date','end_date','basis')) == identity),None)
        if existing:
            existing['pages'] = sorted(set(existing['pages'] + period['pages']))[:16]
            for e in period['evidence']:
                if e not in existing['evidence'] and len(existing['evidence']) < 6:
                    existing['evidence'].append(e)
            issue(index,period,'DUPLICATE_MERGED','info')
        else:
            accepted.append(period)

    for index, raw in enumerate(candidates):
        period = {**raw,'pages':list(raw['pages']),'evidence':[]}
        try:
            end = date.fromisoformat(period['end_date'])
            if period['start_date'] and date.fromisoformat(period['start_date']) > end:
                raise ValueError()
        except (ValueError,TypeError):
            issue(index,period,'PERIOD_DATE_INVALID'); continue
        invalid_quote, signature = False, False
        for e in raw['evidence']:
            source = pages.get(e['page'])
            quote = quote_match(source['text'],e['quote']) if source and e['quote'] else None
            if quote is None:
                invalid_quote = True; continue
            if _signature(source['text'],quote):
                signature = True; continue
            period['evidence'].append({'page':e['page'],'quote':quote})
        period['pages'] = sorted(set(p for p in period['pages'] if p in pages))
        if not period['evidence']:
            issue(index,period,'NON_REPORTING_DATE_IGNORED' if signature and not invalid_quote else 'QUOTE_NOT_IN_SOURCE',
                  'info' if signature and not invalid_quote else 'blocking'); continue
        if not period['pages']:
            issue(index,period,'PERIOD_PAGES_UNREAD'); continue
        if invalid_quote:
            issue(index,period,'EXTRA_QUOTE_REJECTED','info')
        start = _explicit(period,period['evidence'])
        if start:
            period['start_date'] = start
            accept(index,period)
        else:
            pending.append((index,period))

    # Resolve "Năm trước" only within an income/cash-flow statement carrying an
    # independently grounded full calendar year. Opening balance alone is insufficient.
    anchors = list(accepted)
    for index, period in pending:
        resolved = False
        for anchor in anchors:
            end = date.fromisoformat(anchor['end_date'])
            target = date.fromisoformat(period['end_date'])
            if (anchor['kind'] != 'FY' or period['kind'] != 'FY' or anchor['basis'] != period['basis'] or
                anchor['start_date'] != f'{end.year}-01-01' or (end.month,end.day) != (12,31) or
                target.isoformat() != f'{end.year-1}-12-31' or
                period['start_date'] not in (None,f'{end.year-1}-01-01')):
                continue
            context = []
            for e in anchor['evidence']:
                p = pages.get(e['page'])
                if not p or e['page'] not in period['pages']:
                    continue
                label = folded(p['text'])
                if re.search(r'52.week|53.week|ky dau|nam dau|short.year|nien do khac',label):
                    continue
                if not re.search(r'bao cao ket qua|bao cao luu chuyen|income statement|statement.{0,20}(income|cash flow)',label):
                    continue
                previous = _source_label(p['text'],r'\bnam\s+truoc\b|\bprevious year\b|\bprior year\b')
                if previous and str(end.year) in e['quote']:
                    context.extend([e,{'page':e['page'],'quote':previous}])
            if context:
                period['start_date'] = f'{end.year-1}-01-01'
                period['evidence'] = []
                for e in context:
                    if e not in period['evidence'] and len(period['evidence']) < 6:
                        period['evidence'].append(e)
                accept(index,period); resolved = True; break
        if not resolved:
            issue(index,period,'PERIOD_CONTEXT_REQUIRED')

    # An unsupported duplicate suggestion must not invalidate an independently
    # grounded instance of the same scope, while real unresolved scopes remain visible.
    for item in issues:
        if item['severity'] == 'blocking' and any(p['kind']==item['kind'] and p['end_date']==item['end_date'] and
                p['basis']==item['basis'] for p in accepted):
            item['severity'] = 'info'
    return accepted, issues
