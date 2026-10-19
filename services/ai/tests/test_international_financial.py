import copy
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from financial_import.periods import calendar_start
from financial_import.semantics import semantic_issue
from financial_import.international import unit_issue
from providers.spend_budget import reserve, settle, SpendLimit


class InternationalSourceTests(unittest.TestCase):
    def test_english_shifted_and_week_years(self):
        self.assertEqual(calendar_start('FY','2025-11-30','For the fiscal year ended November 30, 2025'),'2024-12-01')
        self.assertEqual(calendar_start('FY','2025-09-27','52 weeks ended September 27, 2025'),'2024-09-29')
        self.assertEqual(calendar_start('FY','2024-09-28','53 weeks ended September 28, 2024'),'2023-09-24')
        self.assertIsNone(calendar_start('FY','2025-11-30','Transition year ended November 30, 2025'))

    def test_chinese_annual_heading_is_not_an_opening_balance(self):
        self.assertEqual(calendar_start('FY','2025-12-31','合并利润表 2025 年度'),'2025-01-01')
        self.assertIsNone(calendar_start('FY','2025-12-31','编制日期 2025年12月31日'))

    def test_cas_legacy_profit_not_promoted_to_operating_income(self):
        self.assertEqual(semantic_issue('operating_profit','营业利润','', 'consolidated','CN'),'OPERATING_PROFIT_BRIDGE_REQUIRED')
        self.assertIsNone(semantic_issue('operating_profit','经营利润','', 'consolidated','CN'))

    def test_aggregate_cash_is_not_an_invented_vn_breakdown(self):
        self.assertIsNone(semantic_issue('eligible_cash_and_equivalents','Cash and cash equivalents','', 'consolidated','US'))
        self.assertIsNotNone(semantic_issue('eligible_cash_and_equivalents','Cash and cash equivalents','', 'consolidated','VN'))
        self.assertIsNotNone(semantic_issue('eligible_cash_and_equivalents','Cash and cash equivalents and restricted cash','', 'consolidated','US'))

    def test_unit_guard_is_page_specific(self):
        self.assertIsNone(unit_issue('单位：万元',{'country':'CN','unit_multiplier':'10000'}))
        self.assertEqual(unit_issue('单位：亿元',{'country':'CN','unit_multiplier':'1'}),'SOURCE_UNIT_MISMATCH')
        self.assertEqual(unit_issue('Currency in thousands',{'country':'US','unit_multiplier':'1000000'}),'SOURCE_UNIT_MISMATCH')
        self.assertEqual(unit_issue('单位：元 附表单位：万元',{'country':'CN','unit_multiplier':'1'}),'SOURCE_UNIT_AMBIGUOUS')

    def test_noncurrent_subtotal_and_cash_netted_debt_are_rejected(self):
        self.assertEqual(semantic_issue('current_assets','Total non-current assets','', 'consolidated','US'),'NONCURRENT_SUBTOTAL_NOT_CURRENT')
        self.assertEqual(semantic_issue('interest_bearing_debt','Total debt net of cash','', 'consolidated','US'),'NET_DEBT_NOT_GROSS_BORROWINGS')


class SpendBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{
            'AI_SPEND_BUDGET_USD':'0.04','AI_SPEND_PROVIDER':'deepseek','AI_SPEND_MODEL':'test-model',
            'AI_SPEND_BASE_URL':'https://api.deepseek.com','AI_SPEND_PRICE_CHECKED_DATE':datetime.now(timezone.utc).date().isoformat(),
            'AI_SPEND_INPUT_USD_PER_MILLION':'1','AI_SPEND_OUTPUT_USD_PER_MILLION':'2',
            'AI_SPEND_MAX_CONTEXT_TOKENS':'1000000','AI_STORAGE_DIR':self.temp.name,
        })
        self.env.start()
        self.provider=SimpleNamespace(name='deepseek',model_id='test-model',config=SimpleNamespace(base_url='https://api.deepseek.com'))
        self.body={'max_tokens':1000,'messages':[{'role':'user','content':'source text'}]}

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    def test_usage_refunds_only_known_reserved_difference(self):
        item=reserve(self.provider,self.body)
        settle(item,{'usage':{'prompt_tokens':100,'completion_tokens':50}})
        with closing(sqlite3.connect(item[0])) as db:
            row=db.execute('SELECT charged_microusd,state FROM requests').fetchone()
        self.assertEqual(row,(200,'usage_estimated'))

    def test_unaccounted_attempts_remain_reserved(self):
        item=reserve(self.provider,self.body)
        settle(item,{'usage':{}})
        with closing(sqlite3.connect(item[0])) as db:
            row=db.execute('SELECT charged_microusd,reserved_microusd,state FROM requests').fetchone()
        self.assertEqual(row[0],row[1]);self.assertEqual(row[2],'reserved')

    def test_concurrent_requests_cannot_overspend(self):
        def attempt(_):
            try:return reserve(self.provider,self.body)
            except SpendLimit:return None
        with ThreadPoolExecutor(max_workers=8) as pool:
            accepted=[v for v in pool.map(attempt,range(12)) if v]
        self.assertEqual(len(accepted),3)
        with closing(sqlite3.connect(accepted[0][0])) as db:
            self.assertLessEqual(db.execute('SELECT SUM(charged_microusd) FROM requests').fetchone()[0],40000)

    def test_other_endpoint_cannot_use_official_provider_quote(self):
        other=copy.deepcopy(self.provider);other.config.base_url='https://gateway.example/v1'
        with self.assertRaisesRegex(Exception,'requires a current price'):reserve(other,self.body)

    def test_image_reservation_uses_full_context_upper_bound(self):
        body={'max_tokens':1000,'messages':[{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/png;base64,AA=='}}]}]}
        with self.assertRaises(SpendLimit):reserve(self.provider,body)

    def test_budget_configuration_cannot_reset_existing_spend(self):
        reserve(self.provider,self.body)
        with patch.dict(os.environ,{'AI_SPEND_BUDGET_USD':'5'}):
            with self.assertRaisesRegex(Exception,'configuration changed'):reserve(self.provider,self.body)

    def test_invalid_usage_retains_reservation(self):
        item=reserve(self.provider,self.body)
        settle(item,{'usage':{'prompt_tokens':True,'completion_tokens':0}})
        with closing(sqlite3.connect(item[0])) as db:
            self.assertEqual(db.execute('SELECT state FROM requests').fetchone()[0],'reserved')
