"""Source-unit guards. No FX, inferred units, or promoted accounting adjustments."""
import re


def unit_issue(page_text, scope):
    if scope['country'] not in ('US', 'CN'):
        return None
    units = set()
    normalized = re.sub(r'\s+', ' ', page_text.lower())
    for match in re.finditer(r'\bin\s+(thousands|millions|billions)\b', normalized):
        units.add({'thousands': '1000', 'millions': '1000000', 'billions': '1000000000'}[match.group(1)])
    for match in re.finditer(r'单位\s*[:：]\s*(?:人民币\s*)?(百万元|千元|万元|亿元|元)', normalized):
        units.add({'元': '1', '千元': '1000', '万元': '10000', '百万元': '1000000', '亿元': '100000000'}[match.group(1)])
    if len(units) > 1:
        return 'SOURCE_UNIT_AMBIGUOUS'
    if units and scope['unit_multiplier'] not in units:
        return 'SOURCE_UNIT_MISMATCH'
    return None
