import { Inject, Injectable } from '@nestjs/common'
import { CaseMutations } from '../foundation/case-mutations'
import { canonicalJson } from '../foundation/canonical'
import { validateContract } from '../foundation/validation'
import type { AuthSession } from '../foundation/ports'
import { DOCUMENT_REPOSITORY } from './ports'
import type { DocumentRepository } from './ports'

@Injectable()
export class DocumentRetryService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    private readonly mutations: CaseMutations,
  ) {}

  async retry(session: AuthSession, id: string, key: string, body: unknown) {
    const input = JSON.parse(canonicalJson(body))
    // ManualRetryInput is the existing ReasonInput contract, with no source,
    // provider, attempt or fencing overrides accepted from the client.
    validateContract('ReasonInput', input)
    const job = await this.documents.job(session, id)
    return this.mutations.execute(session, job.case_id as string, {
      operation: 'job.retry:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const queued = await this.documents.retryFailed(
          tx,
          current.organization_id,
          current.id,
          id,
          Number(current.revision),
        )
        return {
          status: 200,
          body: { job: queued, revision: next },
          action: 'document.retry_requested',
          reason: input.reason,
          subjectId: id,
          metadata: { job_id: id, document_id: queued.document_id, attempts: queued.attempts },
        }
      },
    })
  }
}
