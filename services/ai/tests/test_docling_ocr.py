"""Subprocess protocol tests; real model quality is checked separately on local PDFs."""
import sys
import textwrap
import pytest
from extraction import ocr
from extraction.llm import Deadline
from runner.errors import ServiceError


@pytest.fixture
def local_ocr(tmp_path,monkeypatch):
    script=tmp_path/'local.py'
    script.write_text(textwrap.dedent('''
        import json,os,sys,time
        if '--version' in sys.argv:
            print(json.dumps({'version':'docling-test/easyocr','protocol':'json-lines-v1'}));sys.exit(0)
        assert 'GEMINI_API_KEY' not in os.environ and 'INTERNAL_API_KEY' not in os.environ
        assert os.environ['HF_HUB_OFFLINE']=='1'
        import base64
        for line in sys.stdin.buffer:
            data=base64.b64decode(json.loads(line)['png_base64'])
            if b'FAIL' in data:sys.exit(2)
            if b'SLOW' in data:time.sleep(5)
            print(json.dumps({'text':'Năm 2025 | Năm trước\\nTổng nguồn vốn | 86.805.500.485 | 28.590.423.214'},ensure_ascii=True),flush=True)
    '''),encoding='utf8')
    monkeypatch.setattr(ocr,'DOCLING_SCRIPT',script)
    monkeypatch.setenv('GEMINI_API_KEY','PRIVATE-TEST-KEY')
    monkeypatch.setenv('INTERNAL_API_KEY','PRIVATE-INTERNAL')
    engine=ocr.DoclingOcr(sys.executable,engine='easyocr',lang='vi,en',artifacts_path=str(tmp_path))
    yield engine
    engine.close()


def test_local_ocr_keeps_utf8_numbers_and_never_passes_provider_secrets(local_ocr):
    text=local_ocr.page_text(b'\x89PNG synthetic',4,Deadline(10))
    assert 'Năm 2025 | Năm trước' in text and '86.805.500.485' in text
    assert 'easyocr:vi,en' in local_ocr.version


def test_local_ocr_failure_never_falls_back_to_cloud(local_ocr):
    with pytest.raises(ServiceError) as error:
        local_ocr.page_text(b'\x89PNG FAIL',4,Deadline(10))
    assert error.value.code=='PROVIDER_UNAVAILABLE'


def test_local_ocr_obeys_deadline_and_kills_slow_child(local_ocr):
    with pytest.raises(ServiceError):
        local_ocr.page_text(b'\x89PNG SLOW',4,Deadline(.1))


def test_missing_local_runtime_fails_explicitly(tmp_path):
    with pytest.raises(ServiceError):ocr.DoclingOcr(str(tmp_path/'missing'))


def test_table_text_uses_original_positions_and_keeps_columns_and_numeric_tokens():
    from extraction.docling_page import _spatial_text
    from types import SimpleNamespace
    class Box:
        def __init__(self,l,t,r,b):self.l,self.t,self.r,self.b=l,t,r,b
        def to_top_left_origin(self,_):return self
        def to_bounding_box(self):return self
    def cell(text,l,t,r,b):return SimpleNamespace(text=text,rect=Box(l,t,r,b))
    cells=[cell('tiền',45,10,60,20),cell('chuyển',20,10,43,20),cell('Lưu',1,10,18,20),
           cell('thuần từ hoạt động kinh doanh',1,22,100,32),
           cell('86.805.500.485',150,10,190,20),cell('(5.648.388.423)',210,10,250,20)]
    assert _spatial_text(Box(0,0,110,35),cells,100)=='Lưu chuyển tiền thuần từ hoạt động kinh doanh'
    assert _spatial_text(Box(140,0,200,35),cells,100)=='86.805.500.485'
    assert _spatial_text(Box(201,0,260,35),cells,100)=='(5.648.388.423)'
