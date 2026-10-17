import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { loadConfig } from '../config/configuration'
import { DatabaseService } from '../database/database.service'
import { PostgresDocumentRepository } from './postgres-document.repository'
import { PrivateDocumentFiles } from '../document-storage/private-files'
import { DocumentAiTransport } from '../ai-adapters/document-ai-transport'
import { DocumentWorker } from './document-worker'

/** Explicit local worker process; never starts as an API import side effect. */
async function main() {
  const config = loadConfig()
  const automaticRetry = process.env.AIC_DOCUMENT_AUTOMATIC_RETRY ?? 'true'
  if (!['true', 'false'].includes(automaticRetry)) throw new Error('Invalid automatic retry option')
  if (
    config.documentRuntime !== 'local' ||
    config.isProduction ||
    process.argv.slice(2).some((a) => !['--once', '--poll'].includes(a))
  )
    throw new Error('Local opt-in required')
  const db = new DatabaseService(config)
  let stopping = false
  process.once('SIGINT', () => {
    stopping = true
  })
  process.once('SIGTERM', () => {
    stopping = true
  })
  try {
    await db.onModuleInit()
    const worker = new DocumentWorker(
      new PostgresDocumentRepository(db, config),
      new PrivateDocumentFiles(config.storageDir),
      new DocumentAiTransport({
        baseURL: config.aiServiceUrl,
        internalKey: config.internalApiKey,
        expectedMode: config.documentAiMode,
        contractsDirectory: resolve(__dirname, '../../../../packages/contracts'),
      }),
      { leaseMs: 300_000, maxAttempts: 3, automaticRetry: automaticRetry === 'true' },
    )
    const id = randomUUID()
    do {
      const state = await worker.once(id)
      process.stdout.write('Document worker: ' + state + '\n')
      if (!process.argv.includes('--poll')) break
      if (state === 'idle' && !stopping) await new Promise((r) => setTimeout(r, 1000))
    } while (!stopping)
  } finally {
    await db.onModuleDestroy()
  }
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write('Document worker failed; check private configuration and migrations.\n')
    process.exitCode = 1
  })
