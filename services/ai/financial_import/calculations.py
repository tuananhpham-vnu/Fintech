"""Propose arithmetic only. The API evaluates it; all values remain review-only."""
import json
import os
import re
from decimal import Decimal
from pathlib import Path
from jsonschema import Draft7Validator
from extraction.llm import call_json, MalformedOutput
from runner.errors import ServiceError
from .contract import provider_schema

SCHEMA = json.loads((Path(__file__).resolve().parents[3] / 'packages/contracts/aic-financial-import/calculation-model.schema.json').read_text('utf8'))
PROMPT_VERSION = 'financial-calculation-v1'
SYSTEM = '''Find defensible arithmetic derivations for MISSING financial facts using UNTRUSTED source pages.
Return JSON calculations only; return an empty array when the source is insufficient.
Do NOT calculate the answer. Propose a postfix expression of input IDs and + - * / only.
Example: total liabilities minus long term liabilities: ["liabilities","long_term","-"].
Every input must be an exact printed numeric token with a verbatim quote containing its label and token.
Keep current/comparative columns, complete reporting period, entity, basis, currency and units separate.
Each input must declare its actual period_start, period_end, basis, currency, unit_multiplier and dimension.
Never introduce numeric constants, percentages, estimates, inferred zeroes or other derived inputs.
Only use same-source same-scope inputs; money values use source units; scalars have multiplier 1.
Each input ID occurs exactly once in the expression; inputs must not overlap or count the same amount twice.
Only propose targets in missing_keys. Prefer direct printed facts through the ordinary extraction pipeline.
List every necessary assumption. Nonempty assumptions will BLOCK application, even if arithmetic works.
Do not deduct a general receivables provision from customer receivables without evidence it belongs to those customers.
Do not equate accumulated depreciation with period depreciation; require a complete sourced roll-forward.
Do not equate total liabilities with interest-bearing debt, or assume cash equivalents are unrestricted.
Debt sums require a complete eligible breakdown. Missing breakdown means no proposal, not zero.
For each proposal give a short reason explaining the accounting relationship and input completeness.'''


def propose(provider, scope, pages, facts, missing, deadline):
    if os.environ.get('AI_FINANCIAL_CALCULATIONS') != '1' or not missing:
        return []
    from .service import source_quote, token_value, whitespace, prompt_text
    try:
        raw = call_json(provider, SYSTEM, json.dumps({'scope':scope, 'missing_keys':missing,
            'existing_facts':facts, 'pages':[{'page':p['page'],'text':prompt_text(p['text'])} for p in pages.values()]}, ensure_ascii=False),
            provider_schema(SCHEMA), deadline, 'financial calculation proposals', max_output_tokens=16384)
        if list(Draft7Validator(SCHEMA).iter_errors(raw)):
            return []
        result, used = [], set()
        for proposal in raw['calculations']:
            if proposal['key'] not in missing or proposal['key'] in used:
                continue
            valid = True
            for component in proposal['inputs']:
                page = pages.get(component['page'])
                quote = source_quote(page['text'], component['quote']) if page else None
                token = whitespace(component['raw_token'])
                if (quote is None or whitespace(component['label']) not in whitespace(quote)
                    or not re.search(r'(?<![\d.,])' + re.escape(token) + r'(?![\d.,])', whitespace(quote))
                    or token_value(token, scope['country']) != Decimal(component['value'])):
                    valid = False
                    break
                component['quote'] = quote
            if valid:
                used.add(proposal['key'])
                result.append(proposal)
        return result
    except (MalformedOutput, ServiceError, ValueError, TypeError, KeyError):
        # Optional proposal generation never discards already grounded printed facts.
        return []
