const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { writeReport } = require('../../scripts/lib/report.cjs')
const root = path.resolve(__dirname, '../..')
const sourceRoot = path.join(root, 'src')
const normalize = (file) => path.relative(sourceRoot, file).replaceAll('\\', '/')
const files = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(file)
    else if (/\.tsx?$/.test(file)) files.push(normalize(file))
  }
}
collect(sourceRoot)
const graph = new Map()
const violations = []
function resolve(from, specifier) {
  if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return null
  const base = specifier.startsWith('@/')
    ? path.join(sourceRoot, specifier.slice(2))
    : path.resolve(sourceRoot, path.dirname(from), specifier)
  const target = ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx']
    .map((ext) => base + ext)
    .find((file) => fs.existsSync(file) && fs.statSync(file).isFile())
  if (!target) {
    violations.push(from + ': unresolved ' + specifier)
    return null
  }
  const relative = normalize(target)
  if (relative.startsWith('../')) violations.push(from + ': import leaves src: ' + relative)
  return relative
}
for (const file of files) {
  const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const dependencies = []
  function dependency(specifier, node) {
    const dep = resolve(file, specifier)
    if (!dep) return
    if (/^(lib|hooks|components)\//.test(file) && /^(features|app)\//.test(dep))
      violations.push(file + ': shared layer depends on application feature ' + dep)
    if (/^features\/[^/]+\/api\.ts$/.test(file) && /^(components|hooks|app|features)\//.test(dep))
      violations.push(file + ': API adapter depends on UI/another feature ' + dep)
    if (/^features\/[^/]+\/components\//.test(file) && dep === 'lib/api/client.ts') {
      const bindings = node.importClause?.namedBindings
      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element) =>
          ['request', 'apiPath', 'unknownResponse'].includes(
            (element.propertyName ?? element.name).text,
          ),
        )
      )
        violations.push(file + ': view contains transport imports')
      if (ts.isCallExpression(node) || (bindings && ts.isNamespaceImport(bindings)))
        violations.push(file + ': view imports transport namespace')
    }
    if (/\.tsx?$/.test(dep)) dependencies.push(dep)
  }
  function inspect(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      dependency(node.moduleSpecifier.text, node)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0]
      if (specifier && ts.isStringLiteral(specifier)) dependency(specifier.text, node)
      else violations.push(file + ': dynamic import must have a static path')
    }
    ts.forEachChild(node, inspect)
  }
  inspect(ast)
  if (
    file.startsWith('app/') &&
    /page\.tsx$/.test(file) &&
    /\bfetch\s*\(|\brequest\s*\(/.test(source)
  )
    violations.push(file + ': route contains transport logic')
  graph.set(file, dependencies)
}
const visiting = new Set()
const visited = new Set()
function visit(file, stack = []) {
  if (visiting.has(file)) {
    violations.push('Import cycle: ' + [...stack, file].join(' → '))
    return
  }
  if (visited.has(file)) return
  visiting.add(file)
  for (const dep of graph.get(file) ?? []) visit(dep, [...stack, file])
  visiting.delete(file)
  visited.add(file)
}
for (const file of graph.keys()) visit(file)

const reachable = new Set()
function reach(file) {
  if (reachable.has(file)) return
  reachable.add(file)
  for (const dep of graph.get(file) ?? []) reach(dep)
}
for (const file of files.filter((file) =>
  /^app\/.*\/?(page|layout|route|loading|error|global-error|not-found)\.tsx?$/.test(file),
))
  reach(file)
for (const file of files) {
  if (!reachable.has(file)) violations.push(file + ': orphaned runtime module')
}
const features = [
  'auth',
  'counterparties',
  'cases',
  'documents',
  'evidence',
  'review',
  'questionnaires',
  'assessments',
  'financial',
  'requests',
  'history',
]
for (const feature of features)
  assert.ok(
    fs.existsSync(path.join(sourceRoot, 'features', feature, 'api.ts')),
    feature + ' API boundary missing',
  )
for (const folder of [
  'app',
  'components',
  'features',
  'hooks',
  'lib',
  'archive',
  'audit',
  'artifacts',
  'tmp',
])
  assert.equal(
    fs.existsSync(path.join(root, folder)),
    false,
    'Retired root directory returned: ' + folder,
  )
assert.equal(
  fs.existsSync(path.join(root, 'public/demo-files')),
  false,
  'QA PDFs must not be public production assets',
)
assert.deepEqual(violations, [], violations.join('\n'))
const result = {
  time: new Date().toISOString(),
  passed: true,
  runtimeFiles: files.length,
  businessModules: features.length,
  checks: [
    'static/dynamic imports resolve',
    'source/fixtures isolation',
    'shared-layer direction',
    'feature API boundaries',
    'view/transport separation',
    'thin routes',
    'acyclic source graph',
    'all runtime modules reachable',
    'retired root directories absent',
    'private QA PDFs',
  ],
}
writeReport('architecture.json', result)
console.log(
  'PASS architecture boundaries (' +
    files.length +
    ' runtime files, ' +
    features.length +
    ' modules, no cycles or orphaned modules)',
)
