"""Synthetic intake fixtures: source fidelity, no formula execution, period grounding."""
import base64
import copy
import hashlib
import io
import json
import zipfile

import openpyxl
import pymupdf
import pytest
from PIL import Image
from jsonschema import Draft7Validator
from pathlib import Path
from financial_import.intake import VERSION, prepare, discover
from runner.errors import ServiceError
from providers.base import ModelOutputError, ProviderError
from .test_extraction import FakeModel


def request(data, name='source.pdf'):
    return dict(contract_version=VERSION, name=name, sha256=hashlib.sha256(data).hexdigest(), data_base64=base64.b64encode(data).decode())


def pdf():
    with pymupdf.open() as document:
        page=document.new_page()
        page.insert_text((30,50),'CONSOLIDATED BALANCE SHEETS\nSYNTHETIC Company\n2024-01-01 to 2024-12-31\n2025-01-01 to 2025-12-31\nVND\nTotal assets 100\nNet revenue 0')
        return document.tobytes()


def workbook():
    book=openpyxl.Workbook();sheet=book.active;sheet.title='BCTC 2025'
    sheet.append(['SYNTHETIC Company','2025-01-01 to 2025-12-31'])
    sheet.append(['Total assets',100]);sheet.append(['Net revenue',0]);sheet.append(['Uncached formula','=SUM(B2:B3)'])
    stream=io.BytesIO();book.save(stream);return stream.getvalue()


def test_original_pdf_is_not_truncated_or_rewritten():
    data=pdf();result=prepare(request(data))
    assert base64.b64decode(result['pdf_base64'])==data
    assert result['original_sha256']==result['sha256'] and result['page_count']==1


def test_legacy_xls_stored_values_and_cells_are_read_without_excel_automation():
    import xlwt
    book=xlwt.Workbook();sheet=book.add_sheet('BCTC')
    sheet.write(0,0,'SYNTHETIC Company');sheet.write(1,0,'Net revenue');sheet.write(1,1,0)
    stream=io.BytesIO();book.save(stream)
    result=prepare(request(stream.getvalue(),'source.xls'))
    assert result['locations'][0]['sheet']=='BCTC' and 'B2' in result['locations'][0]['cells']
    assert 'XLS_STORED_VALUES_REQUIRES_REVIEW' in result['warnings']


def test_xlsx_keeps_sheet_cell_coordinates_and_real_zero_without_evaluating_formula():
    result=prepare(request(workbook(),'BCTC.xlsx'))
    assert result['original_sha256']!=result['sha256']
    assert 'FORMULA_WITHOUT_CACHED_VALUE' in result['warnings']
    assert result['locations'][0]['sheet']=='BCTC 2025' and 'B3' in result['locations'][0]['cells']
    with pymupdf.open(stream=base64.b64decode(result['pdf_base64']),filetype='pdf') as doc:
        text=''.join(p.get_text() for p in doc)
    assert 'Net revenue' in text and '\n0\n' in text and 'N/A' in text and 'SUM(' not in text
    definitions=json.loads((Path(__file__).resolve().parents[3]/'packages/contracts/aic-financial-intake/schemas.json').read_text())['definitions']
    Draft7Validator({'definitions':definitions,'$ref':'#/definitions/FinancialIntakePrepared'}).validate(result)


@pytest.mark.parametrize('format,extension',[('PNG','png'),('JPEG','jpg')])
def test_image_creates_single_pdf_page_and_original_hash(format,extension):
    stream=io.BytesIO();Image.new('RGB',(640,480),'white').save(stream,format=format)
    result=prepare(request(stream.getvalue(),'source.'+extension))
    assert result['page_count']==1 and base64.b64decode(result['pdf_base64']).startswith(b'%PDF-')
    assert result['original_sha256']==hashlib.sha256(stream.getvalue()).hexdigest()


def test_active_spreadsheet_package_rejected_before_opening():
    source=workbook();output=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source)) as old,zipfile.ZipFile(output,'w') as new:
        for entry in old.infolist():new.writestr(entry,old.read(entry))
        new.writestr('xl/externalLinks/externalLink1.xml','<untrusted/>')
    with pytest.raises(ServiceError) as error:prepare(request(output.getvalue(),'source.xlsx'))
    assert error.value.code=='SPREADSHEET_ACTIVE_CONTENT'


def test_xlsx_numeric_xml_does_not_lose_decimal_digits_through_binary_float():
    output=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(workbook())) as old,zipfile.ZipFile(output,'w') as new:
        for entry in old.infolist():
            data=old.read(entry)
            if entry.filename=='xl/worksheets/sheet1.xml':data=data.replace(b'<v>100</v>',b'<v>9007199254740993.001</v>')
            new.writestr(entry,data)
    result=prepare(request(output.getvalue(),'source.xlsx'))
    with pymupdf.open(stream=base64.b64decode(result['pdf_base64']),filetype='pdf') as doc:
        assert '9007199254740993.001' in ''.join(p.get_text() for p in doc)


def answer():
    return dict(document_type='financial_statement',entity_name='SYNTHETIC Company',tax_id=None,periods=[dict(kind='FY',start_date=f'{year}-01-01',end_date=f'{year}-12-31',basis='consolidated',pages=[1],evidence=[dict(page=1,quote=f'{year}-01-01 to {year}-12-31')]) for year in [2024,2025]])


def test_all_evidenced_periods_discovered_from_content_not_filename():
    result=discover(request(pdf(),'BCTC_1999.pdf'),FakeModel(answer()))
    assert [p['end_date'] for p in result['periods']]==['2024-12-31','2025-12-31']
    assert result['warnings']==[]


def test_fabricated_period_quote_withheld_and_disclosed():
    raw=answer();raw['periods'][0]['evidence'][0]['quote']='Invented reporting year 2024'
    result=discover(request(pdf()),FakeModel(raw))
    assert len(result['periods'])==1 and result['warnings']==['PERIOD_REVIEW_REQUIRED:2024-12-31:QUOTE_NOT_IN_SOURCE']
    assert result['period_issues'][0]['code']=='QUOTE_NOT_IN_SOURCE'


def test_non_statement_does_not_publish_periods_even_with_suggestive_filename():
    raw=answer();raw['document_type']='other'
    assert discover(request(pdf(),'audited_BCTC_2025.pdf'),FakeModel(raw))['periods']==[]


def test_hash_and_format_mismatch_fail_closed():
    payload=request(pdf());payload['sha256']='0'*64
    with pytest.raises(ServiceError):prepare(payload)
    with pytest.raises(ServiceError):prepare(request(pdf(),'not-an-image.png'))


def test_discovery_repairs_malformed_json_once_using_original_pages():
    malformed = ProviderError('not parseable')
    malformed.__cause__ = json.JSONDecodeError('invalid', 'private response', 0)
    model = FakeModel(malformed, answer())
    result = discover(request(pdf()), model)
    assert len(result['periods']) == 2 and len(model.calls) == 2
    assert model.calls[0]['user'] == model.calls[1]['user']
    assert model.calls[0]['deadline'] == model.calls[1]['deadline']
    assert 'private response' not in model.calls[1]['system']


def test_schema_repair_is_bounded_and_reports_locations_not_private_values():
    raw = answer(); raw['periods'][0]['pages'] = ['PRIVATE VALUE']
    model = FakeModel(raw)
    with pytest.raises(ServiceError) as error:
        discover(request(pdf()), model)
    assert error.value.code == 'INVALID_MODEL_OUTPUT' and len(model.calls) == 2
    details = [d.as_detail() for d in error.value.details]
    assert any(d['message'] == 'SCHEMA_type' and d['path'].startswith('/model/') for d in details)
    assert 'PRIVATE VALUE' not in json.dumps(details) + model.calls[1]['system']


def test_valid_schema_after_one_repair_still_rejects_invented_evidence():
    good = answer(); good['periods'][0]['evidence'][0]['quote'] = 'invented year 2024'
    model = FakeModel({}, good)
    result = discover(request(pdf()), model)
    assert len(result['periods']) == 1 and result['warnings'] == ['PERIOD_REVIEW_REQUIRED:2024-12-31:QUOTE_NOT_IN_SOURCE']


def test_blocked_discovery_is_not_retried_as_json():
    model = FakeModel(ModelOutputError('MODEL_OUTPUT_BLOCKED'))
    with pytest.raises(ServiceError) as error:
        discover(request(pdf()), model)
    assert error.value.code == 'MODEL_OUTPUT_BLOCKED' and len(model.calls) == 1


def test_failed_scanned_page_does_not_discard_readable_pages_or_become_evidence(monkeypatch):
    import financial_import.intake as intake
    pages = [dict(page=1,text='2024-01-01 to 2024-12-31',needs_ocr=False,statement_title=True),
             dict(page=2,text='',needs_ocr=True,statement_title=False)]
    monkeypatch.setattr(intake, 'index_pdf', lambda _: (pages, [1,2]))
    monkeypatch.setattr(intake.pdf, 'render_png', lambda *_: b'synthetic-image')
    class BlockedOcr:
        version = 'blocked-synthetic-partial'
        def page_text(self, *_):
            raise ServiceError(422,'MODEL_OUTPUT_BLOCKED','not returned')
    raw = answer(); raw['periods'] = raw['periods'][:1]
    result = discover(request(pdf()), FakeModel(raw), BlockedOcr())
    assert len(result['periods']) == 1
    assert result['warnings'] == ['DISCOVERY_OCR_PAGE_FAILED:2:MODEL_OUTPUT_BLOCKED']


def test_all_ocr_failures_report_page_and_cause_without_calling_discovery(monkeypatch):
    import financial_import.intake as intake
    monkeypatch.setattr(intake, 'index_pdf', lambda _: (
        [dict(page=1,text='',needs_ocr=True,statement_title=False)], [1]))
    class BlockedOcr:
        version = 'blocked-synthetic-all'
        def page_text(self, *_):
            raise ServiceError(422,'MODEL_OUTPUT_BLOCKED','PRIVATE provider text')
    model = FakeModel(answer())
    with pytest.raises(ServiceError) as error:
        discover(request(pdf()), model, BlockedOcr())
    assert not model.calls and error.value.code == 'MODEL_OUTPUT_BLOCKED'
    assert [d.as_detail() for d in error.value.details] == [{'path':'/ocr/1','message':'MODEL_OUTPUT_BLOCKED'}]
