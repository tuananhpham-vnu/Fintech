import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type {
  RevisionInput,
  DocumentType,
  Job,
  Document,
  DossierAccepted,
  DossierArchiveSummary,
  DossierArchive,
  DossierArchiveList,
  DossierMember,
  DossierMemberSummary,
  DossierCounters,
  DossierIntakeState,
  DossierProcessingState,
  DossierMemberIntakeState,
  DossierMemberProcessingState,
  ExtractionSummary,
  ExtractionSummaryField,
  ExtractionSummaryDiagnostic,
} from '@/lib/api/contracts'
import {
  extraction,
  job,
  dossierAccepted,
  dossierArchive,
  dossierArchiveList,
  dossierMemberSummary,
  extractionSummary,
} from '@/lib/api/decoders'
type ManualRetryInput = RevisionInput & { reason: string }
type DocumentRetryOutput = { job: Job; revision: number }
function retryOutput(value: unknown): DocumentRetryOutput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('revision' in value) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !('job' in value)
  )
    throw new Error('INVALID_API_RESPONSE')
  return { job: job(value.job), revision: Number(value.revision) }
}
export const documentsApi = {
  verifyField: (
    id: string,
    body: RevisionInput & { reason: string; field_key: string; evidence_refs: string[] },
    keys: MutationKey,
  ) => {
    const path = apiPath('documents', id, '/verification')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  classify: (
    id: string,
    body: RevisionInput & {
      reason: string
      declared_type: DocumentType
      subject_match: 'match' | 'mismatch' | 'unresolved'
      reviewed_pages: number[]
      evidence_refs: string[]
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('documents', id, '/classification')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  correct: (
    id: string,
    body: RevisionInput & {
      reason: string
      field_key: string
      value: unknown
      evidence_refs: string[]
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('documents', id, '/corrections')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  job: (id: string, signal?: AbortSignal) => request(apiPath('jobs', id), job, { signal }),
  extraction: (id: string, signal?: AbortSignal) =>
    request(apiPath('documents', id, '/extraction'), extraction, { signal }),
  extractionSummary: (id: string, signal?: AbortSignal) =>
    request(apiPath('documents', id, '/extraction-summary'), extractionSummary, { signal }),
  upload: (id: string, body: FormData, key: string) =>
    request(apiPath('cases', id, '/documents'), unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }),
  uploadArchive: (id: string, body: FormData, key: string) =>
    request(apiPath('cases', id, '/document-archives'), archiveReceipt, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }),
  uploadDossierArchive: (id: string, body: FormData, key: string) =>
    request(apiPath('cases', id, '/dossier-archives'), dossierAccepted, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }),
  listDossierArchives: (caseId: string, signal?: AbortSignal) =>
    request(apiPath('cases', caseId, '/dossier-archives'), dossierArchiveList, { signal }),
  getDossierArchive: (archiveId: string, signal?: AbortSignal) =>
    request(apiPath('dossier-archives', archiveId), dossierArchive, { signal }),
  getDossierMemberSummary: (memberId: string, signal?: AbortSignal) =>
    request(apiPath('dossier-members', memberId, '/extraction-summary'), dossierMemberSummary, {
      signal,
    }),
  retry: (id: string, body: ManualRetryInput, keys: MutationKey) => {
    const path = apiPath('jobs', id, '/retry')
    return request(path, retryOutput, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
}

export type ArchiveRejection = {
  code: string
  retryable?: boolean
  message?: string
}

export type ArchiveItem = {
  entry_index: number
  entry_path: string
  group: string
  suggested_type: DocumentType
  classification_verification: string
  status: 'accepted' | 'rejected'
  document?: Document | null
  job?: Job | null
  rejection?: ArchiveRejection | null
}

export type ArchiveReceipt = {
  archive_sha256: string
  case_id: string
  revision: number
  state: 'accepted' | 'partial' | 'rejected'
  items: ArchiveItem[]
}

function archiveReceipt(value: unknown): ArchiveReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_API_RESPONSE')
  }
  const v = value as Record<string, unknown>
  if (
    typeof v.archive_sha256 !== 'string' ||
    typeof v.case_id !== 'string' ||
    !Number.isSafeInteger(v.revision) ||
    !['accepted', 'partial', 'rejected'].includes(String(v.state)) ||
    !Array.isArray(v.items)
  ) {
    throw new Error('INVALID_API_RESPONSE')
  }
  return value as ArchiveReceipt
}

export type {
  DossierAccepted,
  DossierArchiveSummary,
  DossierArchive,
  DossierArchiveList,
  DossierMember,
  DossierMemberSummary,
  DossierCounters,
  DossierIntakeState,
  DossierProcessingState,
  DossierMemberIntakeState,
  DossierMemberProcessingState,
  ExtractionSummary,
  ExtractionSummaryField,
  ExtractionSummaryDiagnostic,
}
