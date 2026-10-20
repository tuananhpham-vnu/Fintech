// Refuse database URLs that would connect to a hosted database without full TLS verification.
// Used by start.cjs (DATABASE_URL) and predeploy.cjs (AIC_MIGRATION_DATABASE_URL). Never prints the URL itself.
'use strict'
const fs = require('node:fs')

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Returns null when acceptable, otherwise a short reason (no credentials). */
function databaseUrlProblem(name, value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return `${name} is not a valid URL (URL-encode special characters in the password)`
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return `${name} must start with postgresql://`
  if (LOOPBACK.has(url.hostname)) return null // local testing only
  if (url.searchParams.get('sslmode') !== 'verify-full')
    return `${name} must use sslmode=verify-full (certificate and host name verification); see deploy/README.md`
  const root = url.searchParams.get('sslrootcert')
  if (!root) return `${name} must set sslrootcert=/app/deploy/certs/supabase-prod-ca-2021.crt`
  if (!fs.existsSync(root)) return `${name}: sslrootcert file not found at ${root}`
  return null
}

module.exports = { databaseUrlProblem }
