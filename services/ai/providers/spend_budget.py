"""Optional durable spend ceiling. Every HTTP attempt reserves its worst-case cost.

Unknown/failed responses retain their reservation. No prompts, credentials or source
text enter this ledger. SQLite IMMEDIATE transactions cover concurrent processes.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path

from .base import ProviderUnavailable


class SpendLimit(ProviderUnavailable):
    code = 'AI_SPEND_BUDGET_EXHAUSTED'


def _money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0:
            raise ValueError()
        return amount
    except (InvalidOperation, ValueError):
        raise ProviderUnavailable('Invalid AI spend-budget configuration') from None


def _micros(value):
    return int((value * 1_000_000).to_integral_value(rounding=ROUND_CEILING))


def reserve(provider, body):
    """Return a reservation, or None for the unchanged legacy unbudgeted mode."""
    if 'AI_SPEND_BUDGET_USD' not in os.environ:
        return None
    try:
        checked = date.fromisoformat(os.environ['AI_SPEND_PRICE_CHECKED_DATE'])
        age = (datetime.now(timezone.utc).date() - checked).days
        expected = (os.environ['AI_SPEND_PROVIDER'], os.environ['AI_SPEND_MODEL'], os.environ['AI_SPEND_BASE_URL'].rstrip('/'))
        actual = (provider.name, provider.model_id, provider.config.base_url.rstrip('/'))
        if expected != actual or not 0 <= age <= 7:
            raise ValueError()
        root = Path(os.environ.get('AI_SPEND_LEDGER_DIR') or os.environ['AI_STORAGE_DIR']).resolve()
        if not root.is_dir():
            raise ValueError()
        ledger = root / 'ai-spend-budget.sqlite3'
        if ledger.is_symlink():
            raise ValueError()
        limit = _micros(_money(os.environ['AI_SPEND_BUDGET_USD']))
        input_rate = _money(os.environ['AI_SPEND_INPUT_USD_PER_MILLION'])
        output_rate = _money(os.environ['AI_SPEND_OUTPUT_USD_PER_MILLION'])
        maximum_context = int(os.environ['AI_SPEND_MAX_CONTEXT_TOKENS'])
        output = int(body['max_tokens'])
        if not 0 < output < maximum_context <= 2_000_000:
            raise ValueError()
    except (KeyError, ValueError, TypeError, OSError):
        raise ProviderUnavailable('AI spend budget requires a current price, model, endpoint and private ledger') from None
    messages = body['messages']
    has_images = any(isinstance(m['content'], list) for m in messages)
    # UTF-8 bytes upper-bound ordinary text BPE tokens; reserve the entire model
    # input context for images instead of guessing a visual-token price.
    tokens = maximum_context - output if has_images else len(json.dumps(messages, ensure_ascii=False).encode()) + 8192
    if tokens + output > maximum_context:
        raise SpendLimit('Request exceeds the configured model-context reservation')
    held = _micros((tokens * input_rate + output * output_rate) / 1_000_000)
    identity = str(uuid.uuid4())
    with closing(sqlite3.connect(ledger, timeout=15)) as db, db:
        db.execute('PRAGMA busy_timeout=15000')
        db.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), settings TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, charged_microusd INTEGER NOT NULL, reserved_microusd INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, state TEXT NOT NULL)')
        db.execute('BEGIN IMMEDIATE')
        settings = json.dumps([limit, str(input_rate), str(output_rate), *actual, maximum_context])
        before = db.execute('SELECT settings FROM settings WHERE id=1').fetchone()
        if before and before[0] != settings:
            raise ProviderUnavailable('Spend-ledger configuration changed; use an explicitly approved new budget ledger')
        db.execute('INSERT OR IGNORE INTO settings VALUES(1,?)', (settings,))
        used = db.execute('SELECT COALESCE(SUM(charged_microusd),0) FROM requests').fetchone()[0]
        if used + held > limit:
            raise SpendLimit('AI spend ceiling reached; retained reservations include uncertain HTTP attempts')
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,NULL,NULL,?)',
                   (identity, datetime.now(timezone.utc).isoformat(), provider.name, provider.model_id, held, held, 'reserved'))
    return (str(ledger), identity, input_rate, output_rate, held)


def settle(reservation, envelope):
    if reservation is None:
        return
    ledger, identity, input_rate, output_rate, held = reservation
    usage = envelope.get('usage')
    if not isinstance(usage, dict):
        return
    prompt, completion = usage.get('prompt_tokens'), usage.get('completion_tokens')
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in (prompt, completion)):
        return
    # Peak cache-miss rate is conservative, even when cached/off-peak tokens cost less.
    charged = _micros((prompt * input_rate + completion * output_rate) / 1_000_000)
    with closing(sqlite3.connect(ledger, timeout=15)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE requests SET charged_microusd=?,input_tokens=?,output_tokens=?,state=? WHERE id=? AND state=?',
                   (max(charged, held) if charged > held else charged, prompt, completion,
                    'usage_exceeded_reservation' if charged > held else 'usage_estimated', identity, 'reserved'))
    if charged > held:
        raise SpendLimit('Provider usage exceeded reservation; further paid work must stop')
