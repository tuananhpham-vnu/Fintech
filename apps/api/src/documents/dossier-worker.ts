import { randomUUID } from 'node:crypto'
import { FoundationError } from '../foundation/errors'
import { DocumentAiError } from '../ai-adapters/document-ai-transport'
import type { DocumentFiles, DocumentInspector } from './ports'
import { DossierRepository } from './dossier.repository'
import { readZipArchive } from './document-archive'

/** A single bounded unit of intake. Parsing and inspection never hold a DB transaction.
 * Durable archive lease/fence, not this process, owns progress and recovery.
 */
export class DossierWorker {
  constructor(private readonly repository: DossierRepository, private readonly files: DocumentFiles,
    private readonly inspector: DocumentInspector) {}
  async once(workerId = randomUUID()): Promise<string> {
    const attempt = await this.repository.claim(workerId)
    if (!attempt) return 'idle'
    let cached: Awaited<ReturnType<DocumentFiles['materialize']>> | undefined
    try {
      if (attempt.kind === 'archive') {
        const entries = await readZipArchive(attempt.bytes, 'dossier')
        return await this.repository.manifest(attempt, entries) ? 'manifested' : 'discarded'
      }
      cached = await this.files.materialize(attempt.bytes, attempt.sha256)
      const inspection = await this.inspector.inspect(cached.storageKey, attempt.sha256, 30_000)
      return await this.repository.inspected(attempt, inspection) ? inspection.page_count > 10 ? 'review' : 'registered' : 'discarded'
    } catch (error) {
      const code = error instanceof DocumentAiError ? error.code : error instanceof FoundationError ?
        (error.getResponse() as any).code : 'DOSSIER_WORKER_FAILURE'
      const retryable = error instanceof DocumentAiError ? error.retryable :
        !(error instanceof FoundationError) ||
        ['ARCHIVE_READER_BUSY', 'ARCHIVE_READER_TIMEOUT', 'ARCHIVE_READER_UNAVAILABLE'].includes(code)
      await this.repository.fail(attempt, code, retryable)
      return retryable ? 'failed' : 'rejected'
    } finally {
      if (cached) await cached.release()
    }
  }
}
