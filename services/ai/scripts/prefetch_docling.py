"""Download public OCR weights once. No document inputs or API credentials are used."""
from pathlib import Path
import hashlib
import json
from importlib.metadata import version
from docling.utils.model_downloader import download_models

root = Path(__file__).resolve().parents[3]
models = root / 'data/local/docling/models'
download_models(output_dir=models, with_layout=True, with_tableformer=True,
                with_code_formula=False, with_picture_classifier=False, with_rapidocr=False,
                with_easyocr=True, easyocr_languages=['vi','en'], progress=False)
weights=[]
for file in sorted(models.rglob('*')):
    if file.is_file() and file.suffix in {'.pth','.safetensors','.onnx'} and '.cache' not in file.parts:
        with file.open('rb') as stream:
            digest=hashlib.file_digest(stream,'sha256').hexdigest()
        weights.append({'path':file.relative_to(models).as_posix(),'bytes':file.stat().st_size,'sha256':digest})
manifest={'packages':{name:version(name) for name in ['docling','easyocr','torch']},'weights':weights}
(models/'aic-model-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('Docling layout, tables and Vietnamese/English OCR models are ready.')
