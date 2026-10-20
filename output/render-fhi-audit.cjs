// Operator-only policy diagnostic. No writes to the database or policy files.
// node /tmp/render-fhi-audit.cjs CASE_UUID
// Fresh file/environment checks are NOT an inspection of the running API's config,
// and syntactically valid approval metadata does NOT authenticate owner approval.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const APP = '/app'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const nonempty = v => typeof v === 'string' && v.trim().length > 0
const date = v => nonempty(v) && Number.isFinite(Date.parse(v))
const unique = xs => new Set(xs).size === xs.length

function policyCheck(key, kind, context, modules) {
  const configured = process.env[key]
  const out = { configured: !!configured, loaded_valid: false, checks: {}, failures: [] }
  const check = (name, passed, failure) => {
    out.checks[name] = !!passed
    if (!passed) out.failures.push(failure)
  }
  if (!configured) {
    out.failures.push('POLICY_PATH_UNSET')
    return { out, policy: undefined }
  }
  const filename = path.resolve(APP + '/apps/api', configured)
  let raw, p
  try {
    raw = fs.readFileSync(filename, 'utf8')
    check('file_readable', true)
  } catch (error) {
    check('file_readable', false, error.code === 'ENOENT' ? 'POLICY_FILE_NOT_FOUND'
      : error.code === 'EACCES' || error.code === 'EPERM' ? 'POLICY_FILE_NOT_READABLE' : 'POLICY_FILE_READ_FAILED')
    return { out, policy: undefined }
  }
  try { p = JSON.parse(raw) } catch {
    out.failures.push('POLICY_JSON_INVALID')
    return { out, policy: undefined }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    out.failures.push('POLICY_OBJECT_REQUIRED')
    return { out, policy: undefined }
  }
  check('policy_id_valid', nonempty(p.policy_id), 'POLICY_ID_REQUIRED')
  check('organization_ids_valid', Array.isArray(p.organization_ids) && p.organization_ids.length > 0
    && p.organization_ids.every(id => typeof id === 'string' && UUID.test(id))
    && unique(p.organization_ids), 'ORGANIZATION_IDS_INVALID')
  check('approval_by_present', nonempty(p.approval?.by), 'APPROVAL_BY_REQUIRED')
  check('approval_source_present', nonempty(p.approval?.source), 'APPROVAL_SOURCE_REQUIRED')
  check('approval_scope_present', nonempty(p.approval?.scope), 'APPROVAL_SCOPE_REQUIRED')
  check('approval_recorded_at_valid', date(p.approval?.recorded_at), 'APPROVAL_RECORDED_AT_INVALID')
  check('effective_from_valid', date(p.effective_from), 'EFFECTIVE_FROM_INVALID')
  check('effective_until_valid', p.effective_until === null || date(p.effective_until), 'EFFECTIVE_UNTIL_INVALID')
  if (date(p.approval?.recorded_at) && date(p.effective_from))
    check('effective_after_approval', Date.parse(p.effective_from) >= Date.parse(p.approval.recorded_at), 'EFFECTIVE_BEFORE_APPROVAL')
  if (date(p.effective_from) && date(p.effective_until))
    check('effective_interval_valid', Date.parse(p.effective_until) > Date.parse(p.effective_from), 'EFFECTIVE_INTERVAL_INVALID')
  if (kind === 'fhi') {
    check('method_id_matches', p.method_id === modules.method.FHI_METHOD_ID, 'METHOD_ID_MISMATCH')
    check('method_version_matches', p.method_version === modules.method.FHI_METHOD_VERSION, 'METHOD_VERSION_MISMATCH')
    check('method_hash_matches', p.method_hash === modules.fhi.fhiMethodHash(), 'METHOD_HASH_MISMATCH')
    check('industry_scope_matches', p.industry_scope === modules.method.FHI_PILOT_SCOPE, 'INDUSTRY_SCOPE_MISMATCH')
    check('status_valid', ['configured_pilot', 'validation_pending'].includes(p.status), 'POLICY_STATUS_INVALID')
  } else {
    check('status_valid', p.status === 'configured_pilot', 'POLICY_STATUS_INVALID')
    const profiles = Array.isArray(p.profiles) ? p.profiles : []
    check('profiles_valid', profiles.length > 0 && profiles.every(v => v && typeof v.profile_id === 'string')
      && unique(profiles.map(v => v?.profile_id)), 'PROFILES_INVALID')
    check('profile_ids_known', profiles.every(v => modules.intl.ACCOUNTING_PROFILES.some(x => x.id === v?.profile_id)), 'PROFILE_ID_UNKNOWN')
    check('profile_hashes_match', profiles.every(v => {
      const profile = modules.intl.ACCOUNTING_PROFILES.find(x => x.id === v?.profile_id)
      return profile && v.method_hash === modules.intl.profileMethodHash(profile)
    }), 'PROFILE_METHOD_HASH_MISMATCH')
  }
  // Use the deployed loader as the authority; supplemental checks only explain failure.
  let policy
  try {
    policy = (kind === 'fhi' ? modules.fhi.loadFhiPolicy : modules.intl.loadInternationalPolicy)(filename)
    if (fs.readFileSync(filename, 'utf8') !== raw) {
      out.failures.push('POLICY_FILE_CHANGED_DURING_CHECK')
      return { out, policy: undefined }
    }
    out.loaded_valid = true
  } catch {
    if (!out.failures.length) out.failures.push('DEPLOYED_LOADER_REJECTED')
  }
  const instant = new Date(context.at).getTime()
  check('organization_matches_case', Array.isArray(p.organization_ids) && p.organization_ids.includes(context.organization_id), 'CASE_ORGANIZATION_NOT_AUTHORIZED')
  if (date(p.approval?.recorded_at))
    check('approval_recorded_now', Date.parse(p.approval.recorded_at) <= instant, 'APPROVAL_IN_FUTURE')
  if (date(p.effective_from))
    check('effective_started', Date.parse(p.effective_from) <= instant, 'POLICY_NOT_YET_EFFECTIVE')
  if (date(p.effective_until))
    check('effective_not_expired', instant < Date.parse(p.effective_until), 'POLICY_EXPIRED')
  return { out, policy }
}

async function main(caseId) {
  if (!UUID.test(caseId || '')) return { failure: 'CASE_UUID_INVALID' }
  // All imports/errors remain inside the caller's sanitized error boundary.
  const modules = {
    fhi: require(APP + '/apps/api/dist/financial/fhi-policy'),
    intl: require(APP + '/apps/api/dist/financial/accounting-profiles'),
    method: require(APP + '/apps/api/dist/financial/fhi-method'),
  }
  const { countryCode } = require(APP + '/apps/api/dist/financial/financial-import-source')
  const { databaseUrlProblem } = require(APP + '/deploy/backend/db-url.cjs')
  if (databaseUrlProblem('DATABASE_URL', process.env.DATABASE_URL))
    return { failure: 'DATABASE_TLS_CONFIGURATION_REJECTED' }
  const { Client } = require(APP + '/apps/api/node_modules/pg')
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
  try {
    await db.connect()
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await db.query("SET LOCAL statement_timeout = '10s'")
    const context = (await db.query(`SELECT c.organization_id,c.purpose,p.country,clock_timestamp() AS at
      FROM aic.cases c JOIN aic.counterparties p ON p.organization_id=c.organization_id AND p.id=c.counterparty_id
      WHERE c.id=$1`, [caseId])).rows[0]
    if (!context) return { failure: 'CASE_NOT_FOUND' }
    const fhi = policyCheck('AIC_FHI_POLICY_PATH', 'fhi', context, modules)
    const international = policyCheck('AIC_INTERNATIONAL_POLICY_PATH', 'international', context, modules)
    const country = countryCode(context.country)
    const selected = country === 'VN' ? 'fhi' : context.purpose === 'company_health' ? 'international' : null
    const chosen = selected === 'fhi' ? fhi : selected === 'international' ? international : null
    const failures = chosen ? [...chosen.out.failures] : ['CASE_PURPOSE_NOT_SUPPORTED']
    if (selected === 'international' && !modules.intl.ACCOUNTING_PROFILES.some(profile =>
      profile.country === country && international.policy?.profiles.some(v => v.profile_id === profile.id)))
      failures.push('COUNTRY_PROFILE_NOT_AUTHORIZED')
    const active = selected === 'fhi'
      ? modules.fhi.activeFhiPolicy(fhi.policy, context.organization_id, new Date(context.at).toISOString())
      : selected === 'international'
        ? modules.intl.internationalPolicy({ internationalPolicy: international.policy }, context.organization_id, new Date(context.at).toISOString(), country)
        : null
    if (!active && !failures.length) failures.push('CASE_POLICY_INACTIVE')
    return {
      configuration_source: 'fresh_loader_check_not_running_process',
      fhi: fhi.out, international: international.out,
      case_policy: { selected, eligible_now: !!active && failures.length === 0, failures },
    }
  } finally {
    try { await db.query('ROLLBACK') } finally { await db.end() }
  }
}

module.exports = { main, policyCheck }
if (require.main === module) main(process.argv[2])
  .then(report => console.log(JSON.stringify(report, null, 2)))
  .catch(() => { console.error('{"failure":"AUDIT_EXECUTION_FAILED"}'); process.exitCode = 1 })
