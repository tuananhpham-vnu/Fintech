import { readFileSync } from 'fs'
import { resolve } from 'path'
import { randomUUID, createHash } from 'crypto'
import { Client } from 'pg'
import { hashPassword } from '../auth'
import { requestHash } from '../foundation/canonical'

/** Explicit operator bootstrap for a fresh disposable sandbox; no automatic migration. */
export async function bootstrapSandbox() {
  if (process.env.NODE_ENV === 'production' || process.env.AIC_SANDBOX_BOOTSTRAP !== 'true')
    throw new Error('Explicit sandbox opt-in required')
  const url = new URL(process.env.DATABASE_URL || '')
  // Hosted demo (e.g. Supabase) needs a second explicit opt-in and a TLS connection string.
  const remoteDemo =
    process.env.AIC_SANDBOX_REMOTE_DEMO === 'true' &&
    ['require', 'verify-ca', 'verify-full', 'no-verify'].includes(url.searchParams.get('sslmode') || '')
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    (!remoteDemo &&
      (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/aic_mvp_[a-z0-9_]+$/.test(url.pathname)))
  )
    throw new Error('Fresh named loopback sandbox required')
  const orgId = process.env.AIC_SANDBOX_ORGANIZATION_ID || ''
  const username = process.env.AIC_SANDBOX_USERNAME || '',
    password = process.env.AIC_SANDBOX_PASSWORD || ''
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !username.trim() || password.length < 16)
    throw new Error('Explicit identity and password required')
  const file = resolve(
    __dirname,
    '../../../../docs/implementation/policies/AIC-MVP-SANDBOX-2026-10-17.1.json',
  )
  const bytes = readFileSync(file),
    artifact = JSON.parse(bytes.toString())
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (
    hash !== readFileSync(file + '.sha256', 'utf8').split('  ')[0] ||
    hash !== requestHash(artifact) ||
    artifact.status !== 'approved' ||
    artifact.approval?.scope !== 'MVP sandbox only'
  )
    throw new Error('Invalid approved artifact')
  const encoded = await hashPassword(password)
  const db = new Client({ connectionString: url.href })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL synchronous_commit='on'")
    // This is intentionally insert-only. Never reset/reprovision an existing identity or tenant.
    await db.query("INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC MVP SANDBOX')", [
      orgId,
    ])
    const userId = randomUUID()
    await db.query(
      "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,'Sandbox specialist','specialist')",
      [userId, orgId, username, encoded],
    )
    await db.query(
      `INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from)
      VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(version) DO NOTHING`,
      [
        artifact.policy_version,
        hash,
        artifact,
        artifact.approval.recorded_at,
        artifact.effective_from,
      ],
    )
    const pinned = (
      await db.query('SELECT sha256 FROM aic.mvp_policy_artifacts WHERE version=$1', [
        artifact.policy_version,
      ])
    ).rows[0]
    if (pinned?.sha256 !== hash) throw new Error('Policy version already bound to different bytes')
    for (const kind of ['RECEIVABLE', 'PREPAYMENT'])
      await db.query(
        `INSERT INTO aic.mvp_policy_assignments
      (id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from)
      VALUES($1,$2,$3,$4,$5,GREATEST(clock_timestamp(),$6::timestamptz))`,
        [randomUUID(), orgId, artifact.policy_version, hash, kind, artifact.effective_from],
      )
    for (const [name, tax] of [
      ['SYNTHETIC Buyer Alpha', '0000000001'],
      ['SYNTHETIC Supplier Beta', '0000000002'],
    ])
      await db.query(
        "INSERT INTO aic.counterparties(id,organization_id,name,country,tax_id) VALUES($1,$2,$3,'VN',$4)",
        [randomUUID(), orgId, name, tax],
      )
    await db.query('COMMIT')
    process.stdout.write(
      'Sandbox tenant, specialist, unresolved synthetic counterparties and explicit core policy assignments created. No case or verified facts seeded.\n',
    )
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    await db.end()
  }
}
if (require.main === module)
  bootstrapSandbox().catch(() => {
    process.stderr.write(
      'Sandbox bootstrap refused or failed. No credentials logged; check opt-in, fresh tenant, migrations and operator permissions.\n',
    )
    process.exitCode = 1
  })
