import pymupdf
import pytest
from extraction import pdf


@pytest.mark.parametrize('text',['Hợp đồng số HĐ01. Doanh nghiệp Việt Nam. Mã số thuế: 0109876543','企业名称：示例科技有限公司'])
def test_missing_identity_unicode_map_is_detected_without_relying_on_invalid_characters(text):
    with pymupdf.open() as doc:
        doc.new_page().insert_htmlbox(pymupdf.Rect(40,40,550,800),text)
        native=doc.tobytes()
        assert not pdf.inspect(native,with_pages=True).pages[0].needs_ocr
        for font in doc[0].get_fonts():
            doc.xref_set_key(font[0],'ToUnicode','null')
        info=pdf.inspect(doc.tobytes(),with_pages=True).pages[0]
        assert info.needs_ocr and info.ocr_reason=='garbled'


def test_standard_font_without_tounicode_is_not_forced_to_ocr():
    with pymupdf.open() as doc:
        doc.new_page().insert_text((40,60),'Company SAMPLE LTD. Tax ID 0109876543')
        for font in doc[0].get_fonts():
            doc.xref_set_key(font[0],'ToUnicode','null')
        assert not pdf.inspect(doc.tobytes(),with_pages=True).pages[0].needs_ocr
