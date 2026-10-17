// This file is forked only by crash-recovery-worker.stress.cjs. No credentials on disk/argv.
const { Pool } = require('pg')
const { database } = require('./harness.cjs')
const { PostgresDocumentRepository } = require('../../dist/documents/postgres-document.repository')
const { PrivateDocumentFiles } = require('../../dist/document-storage/private-files')
const { DocumentWorker } = require('../../dist/documents/document-worker')

process.once('message', async ({ connectionString, root, config }) => {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
  try {
    const repository = new PostgresDocumentRepository(database(pool), config)
    let claimed
    const claim = repository.claim.bind(repository)
    repository.claim = async (...args) => { claimed = await claim(...args); return claimed }
    const ai = { extract: async ({ storageKey }) => {
      const { bytes, ...attempt } = claimed
      process.send({ type: 'paused-at-extract', storageKey, attempt })
      // Keep the actual DocumentWorker.once() suspended after materialize + heartbeat.
      setInterval(() => {}, 1000)
      return new Promise(() => {})
    } }
    await new DocumentWorker(repository, new PrivateDocumentFiles(root), ai,
      { leaseMs: 60000, maxAttempts: 3 }).once('accept-security-crash-child')
    process.send({ type: 'unexpected-worker-return' })
    await pool.end()
    process.exitCode = 1
    process.disconnect()
  } catch {
    // Never serialize pg error details or the connection string to the parent.
    process.send({ type: 'child-failed' })
    await pool.end()
    process.exitCode = 1
    process.disconnect()
  }
})
