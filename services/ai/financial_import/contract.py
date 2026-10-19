from __future__ import annotations

VERSION = "AIC-FINANCIAL-IMPORT-1"
KEYS = (
    "current_assets", "current_liabilities", "cash", "unrestricted_short_term_equivalents",
    "trade_receivables", "total_equity", "total_assets", "total_liabilities",
    "interest_bearing_debt", "operating_profit", "depreciation_amortization",
    "interest_expense", "net_revenue", "cash_from_operations",
)
EXTRA_KEYS = ('eligible_cash_and_equivalents',)

def obj(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required, "additionalProperties": False}

STRING = {"type": "string", "maxLength": 500}
DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
SCOPE = obj({
    "entity_name": STRING,
    "country": {"enum": ["VN", "US", "CN"]},
    "period_kind": {"enum": ["FY", "INTERIM", "TTM"]},
    "start_date": DATE, "end_date": DATE,
    "basis": {"enum": ["standalone", "consolidated"]},
    "accounting_regime": {"enum": ["VN_TT133", "VN_TT200", "VN_TT99", "VN_TT58", "US_GAAP", "CN_ASBE", "IFRS", "OTHER", "UNKNOWN"]},
    "currency": {"enum": ["VND", "USD", "CNY", "HKD", "EUR", "GBP", "JPY"]},
    "unit_multiplier": {"type": "string", "pattern": r"^[1-9][0-9]{0,11}$"},
})
EVIDENCE = obj({"page": {"type": "integer", "minimum": 1, "maximum": 600},
                "quote": {"type": "string", "minLength": 1, "maxLength": 4000}})
MODEL = obj({
    "document_type": {"enum": ["financial_statement", "other"]},
    "scope": SCOPE,
    "scope_evidence": {"type": "array", "items": EVIDENCE, "minItems": 1, "maxItems": 12},
    "facts": {"type": "array", "maxItems": 15, "items": obj({
        "key": {"enum": list(KEYS + EXTRA_KEYS)},
        "value": {"type": "string", "pattern": r"^-?[0-9]{1,30}(\.[0-9]{1,12})?$"},
        "raw_token": {"type": "string", "minLength": 1, "maxLength": 100},
        "label": STRING,
        "page": {"type": "integer", "minimum": 1, "maximum": 600},
        "quote": {"type": "string", "minLength": 1, "maxLength": 4000},
        "period_end": DATE,
        "basis": {"enum": ["standalone", "consolidated"]},
    })},
})

def provider_schema(node):
    """Small provider grammar; application still validates the FULL versioned schema.

    Provider numeric/string bounds and regex constraints can reject an otherwise
    valid financial schema with HTTP400. They are enforced after generation.
    """
    if isinstance(node,list):
        return [provider_schema(value) for value in node]
    if not isinstance(node,dict):
        return node
    return {key:({name:provider_schema(value) for name,value in child.items()} if key=='properties' else provider_schema(child))
            for key,child in node.items() if key in {'type','properties','items','required','enum','additionalProperties','maxLength'}}
