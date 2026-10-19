// Separate CPU runtime; only setup downloads models. Document OCR runs offline.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const bin = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const python = path.join(root,'.venv-docling',bin);
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>
  /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT)$/i.test(key)));
Object.assign(env,{PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HOME:path.join(root,'data/local/docling/hf'),
  HF_HUB_DISABLE_TELEMETRY:'1',OMP_NUM_THREADS:'2'});
function run(executable,args) {
  const result=spawnSync(executable,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0) throw new Error('Docling setup failed; see the preceding dependency/model error.');
}
try {
  if(!fs.existsSync(python)) run(path.join(root,'.venv',bin),['-m','venv',path.join(root,'.venv-docling')]);
  run(python,['-m','pip','install','torch==2.14.1','torchvision==0.29.1',
    '--index-url','https://download.pytorch.org/whl/cpu','--disable-pip-version-check']);
  run(python,['-m','pip','install','docling[easyocr,rapidocr]==2.140.0','--disable-pip-version-check']);
  run(python,['-X','utf8',path.join(root,'services/ai/scripts/prefetch_docling.py')]);
} catch(error) { console.error(error.message);process.exitCode=1; }
