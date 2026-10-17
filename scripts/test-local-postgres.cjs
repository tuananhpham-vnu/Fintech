// Creates only a fresh private loopback cluster. Never connects to the user's DB.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path')
const { randomBytes } = require('node:crypto')
const { spawnSync, execFileSync } = require('node:child_process')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-pg-check-'))
const bin = process.env.AIC_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const data = path.join(root, 'data'),
  pw = path.join(root, 'password')
const port = 15432,
  username = 'aic_test_owner',
  password = randomBytes(32).toString('hex')
if (process.platform === 'win32')
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
  $ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
  $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false);
  foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) { $identity=New-Object Security.Principal.SecurityIdentifier($sid); $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))) };
  [IO.Directory]::SetAccessControl($env:AIC_PG_TEST_ROOT,$acl)
`,
    ],
    {
      env: { ...process.env, AIC_PG_TEST_ROOT: root },
      windowsHide: true,
      stdio: 'pipe',
      timeout: 15000,
    },
  )
else fs.chmodSync(root, 0o700)
fs.writeFileSync(pw, password, { mode: 0o600, flag: 'wx' })
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error('Test process failed: ' + path.basename(file) + ' exit=' + result.status)
}
let started = false
try {
  run(path.join(bin, 'initdb.exe'), [
    '-D',
    data,
    '-U',
    username,
    '--pwfile=' + pw,
    '--auth=scram-sha-256',
    '--encoding=UTF8',
    '--locale=C',
  ])
  run(path.join(bin, 'pg_ctl.exe'), [
    '-D',
    data,
    '-l',
    path.join(root, 'server.log'),
    '-o',
    '-h 127.0.0.1 -p ' + port,
    '-w',
    'start',
  ])
  started = true
  const url = new URL('postgresql://127.0.0.1:' + port + '/postgres')
  url.username = username
  url.password = password
  const tests = process.argv.slice(2)
  if (!tests.length) throw new Error('Supply explicit test files')
  run(process.execPath, ['--test', ...tests], {
    env: { ...process.env, AIC_TEST_DATABASE_URL: url.href, AIC_ALLOW_LOCAL_DB_TESTS: 'true' },
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (started) {
    const result = spawnSync(
      path.join(bin, 'pg_ctl.exe'),
      ['-D', data, '-m', 'fast', '-w', 'stop'],
      { stdio: 'inherit', windowsHide: true, timeout: 30000 },
    )
    if (result.status !== 0) process.exitCode = 1
  }
  fs.unlinkSync(pw)
  console.log('Disposable cluster stopped; diagnostic data retained at ' + root)
}
