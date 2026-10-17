// PDF rendering is entirely local; never fetch workers, fonts or CMaps from a CDN.
const fs = require('node:fs')
const path = require('node:path')
const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
const output = path.join(__dirname, '..', 'public', 'pdfjs')
fs.mkdirSync(output, { recursive: true })
fs.copyFileSync(
  path.join(root, 'build', 'pdf.worker.min.mjs'),
  path.join(output, 'pdf.worker.min.mjs'),
)
for (const name of ['cmaps', 'standard_fonts', 'wasm'])
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true })
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'))
