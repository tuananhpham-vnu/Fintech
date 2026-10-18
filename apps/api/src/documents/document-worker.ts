import { randomUUID } from 'crypto'
import { DocumentAiTransport, DocumentAiError } from '../ai-adapters/document-ai-transport'
import type { DocumentFiles, DocumentWorkerRepository } from './ports'
import type { StoredDocument } from './ports'
import { projectLegacyExtraction, EvidenceProjectionError } from './evidence-projection'

/** One bounded attempt; external scheduler owns polling and process lifecycle. */
export class DocumentWorker {
  constructor(
    private readonly repository: DocumentWorkerRepository,
    private readonly files: DocumentFiles,
    private readonly ai: DocumentAiTransport,
    private readonly options: { leaseMs: number; maxAttempts: number; automaticRetry?: boolean } = {
      leaseMs: 300_000,
      maxAttempts: 3,
    },
  ) {
    if (
      !Number.isSafeInteger(options.leaseMs) ||
      options.leaseMs < 1 ||
      !Number.isSafeInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      (options.automaticRetry !== undefined && typeof options.automaticRetry !== 'boolean')
    )
      throw new Error('Invalid worker limits')
  }
  async once(workerId = randomUUID()): Promise<'idle' | 'published' | 'discarded' | 'failed'> {
    const attempt = await this.repository.claim(
      workerId,
      this.options.leaseMs,
      this.options.maxAttempts,
    )
    if (!attempt) return 'idle'
    let cached: Awaited<ReturnType<DocumentFiles['materialize']>> | undefined
    try {
      cached = await this.files.materialize(attempt.bytes, attempt.sha256)
      // Provider deadline240s is below default lease300s. Expired leases never revive;
      // SQL fencing is authoritative even if this process resumes late.
      if (!(await this.repository.heartbeat(attempt, this.options.leaseMs))) return 'discarded'
      const result = await this.ai.extract({
        storageKey: cached.storageKey,
        documentId: attempt.documentId,
        caseId: attempt.caseId,
        type: attempt.type,
        sha256: attempt.sha256,
      })
      // Canonical DTO validation alone cannot know the actual inspected page
      // count or whether this FE projection is unambiguous for human correction.
      projectLegacyExtraction(
        {
          id: attempt.documentId,
          case_id: attempt.caseId,
          version: attempt.documentVersion,
          hash: attempt.sha256,
          pages: attempt.pages,
        } as StoredDocument,
        result.body,
      )
      if ((result.body.pages as unknown[]).length !== attempt.pages)
        throw new EvidenceProjectionError('INVALID_PAGE')
      return (await this.repository.publish(attempt, result.body, result.mode))
        ? 'published'
        : 'discarded'
    } catch (error) {
      await this.repository.fail(
        attempt,
        error instanceof DocumentAiError
          ? error.code
          : error instanceof EvidenceProjectionError
            ? 'AI_INVALID_PROJECTION'
            : 'DOCUMENT_WORKER_FAILURE',
        error instanceof DocumentAiError ? error.retryable : false,
        this.options.maxAttempts,
        this.options.automaticRetry ?? true,
      )
      return 'failed'
    } finally {
      if (cached) await cached.release()
    }
  }
}
