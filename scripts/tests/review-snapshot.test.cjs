const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { createHash } = require('node:crypto')
const { safePath, verify } = require('../create-review-snapshot.cjs')
test('snapshot path rejects traversal and absolute paths', () => {
  const root = path.resolve(os.tmpdir(), 'aic-review-path')
  for (const value of [
    '../private.env',
    'source/../../secret',
    'C:/private.key',
    '/secret',
    'source\\..\\secret',
  ])
    assert.throws(() => safePath(root, value))
  assert.equal(safePath(root, 'source/app.ts'), path.join(root, 'source', 'app.ts'))
})
test('fixed review bytes verify; changed or missing source fails without changing the original', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-review-verification-')),
    bytes = Buffer.from('SYNTHETIC SOURCE'),
    file = path.join(root, 'source.txt')
  fs.writeFileSync(file, bytes)
  fs.writeFileSync(
    path.join(root, 'MANIFEST.json'),
    JSON.stringify({
      head: 'synthetic',
      files: [
        {
          path: 'source.txt',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    }),
  )
  assert.equal(verify(root).files, 1)
  fs.writeFileSync(path.join(root, 'unexpected.cjs'), 'SYNTHETIC EXTRA')
  assert.throws(() => verify(root), /Unexpected snapshot file/)
  fs.unlinkSync(path.join(root, 'unexpected.cjs'))
  fs.writeFileSync(file, 'changed')
  assert.throws(() => verify(root), /checksum mismatch/)
  fs.unlinkSync(file)
  assert.throws(() => verify(root))
  fs.unlinkSync(path.join(root, 'MANIFEST.json'))
  fs.rmdirSync(root)
})
