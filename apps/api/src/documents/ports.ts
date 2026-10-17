/** MVP-DOC-1: technical slice, Lead sole writer. No policy/claims approval implied. */
import type { AuthSession, SqlClient } from '../foundation/ports'

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY')
export const DOCUMENT_FILES = Symbol('DOCUMENT_FILES')
export const DOCUMENT_INSPECTOR = Symbol('DOCUMENT_INSPECTOR')
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
export const DOCUMENT_MAX_PAGES = 10
export const DOCUMENT_MAX_ACTIVE = 10
export const DOCUMENT_MAX_ACTIVE_PAGES = 40
// Bounded local recovery: reserve one full default worker lease before the
// 24-hour job deadline. This does not extend the original job's lifetime.
export const DOCUMENT_RETRY_MAX_ATTEMPTS = 3
export const DOCUMENT_RETRY_DEADLINE_MS = 24 * 60 * 60 * 1000
export const DOCUMENT_RETRY_MIN_REMAINING_MS = 300_000
export const DOCUMENT_TYPES = [
  'registration',
  'loan_request',
  'financial_statement',
  'contract',
  'acceptance_record',
  'payment_record',
  'invoice',
  'other',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export interface DocumentUpload {
  mode: 'new' | 'replace' | 'response'
  type: DocumentType
  sourceClass: string
  expectedRevision: number
  replacesDocumentId?: string
  responseRequestId?: string
  displayName: string
  bytes: Buffer
  sha256: string
  pageCount: number
  aiMode: 'live' | 'mock'
}
export interface StoredDocument {
  id: string
  organization_id: string
  case_id: string
  lineage: string
  version: number
  hash: string
  byte_size: number
  pages: number
  name: string
  type: string
  source_class: string
  status: string
  created_at: string | Date
  created_by: string
  active: boolean
  ai_mode: 'live' | 'mock'
  extraction: unknown | null
  source_review?: Record<string, unknown> | null
}
export interface DocumentAcceptResult {
  status: 202
  body: { document: Record<string, unknown>; job: Record<string, unknown>; revision: number }
  replayed: boolean
}
export interface DocumentRepository {
  replay(
    session: AuthSession,
    caseId: string,
    key: string,
    upload: Omit<DocumentUpload, 'pageCount' | 'aiMode'>,
  ): Promise<DocumentAcceptResult | null>
  accept(
    session: AuthSession,
    caseId: string,
    key: string,
    upload: DocumentUpload,
  ): Promise<DocumentAcceptResult>
  list(session: AuthSession, caseId: string): Promise<StoredDocument[]>
  read(
    session: AuthSession,
    documentId: string,
  ): Promise<{ document: StoredDocument; bytes: Buffer }>
  job(session: AuthSession, jobId: string): Promise<Record<string, unknown>>
  evidenceDocument(session: AuthSession, evidenceId: string): Promise<StoredDocument>
  listJobs(session: AuthSession, caseId: string): Promise<Record<string, unknown>[]>
  retryFailed(
    tx: SqlClient,
    organizationId: string,
    caseId: string,
    jobId: string,
    currentRevision: number,
  ): Promise<Record<string, unknown>>
}
/** Private cache only. Canonical accepted bytes live transactionally in PostgreSQL. */
export interface DocumentFiles {
  materialize(
    bytes: Buffer,
    sha256: string,
  ): Promise<{ storageKey: string; release(): Promise<void> }>
}
export interface DocumentInspector {
  inspect(
    storageKey: string,
    sha256: string,
    timeoutMs?: number,
  ): Promise<{
    sha256: string
    page_count: number
    byte_size: number
    encrypted: boolean
    has_embedded_files: boolean
    mode: 'mock' | 'live'
  }>
}

/** Exact SQL row layout for single persistence writer; tables are aic.mvp_*. */
export interface DocumentAttempt {
  jobId: string
  organizationId: string
  caseId: string
  documentId: string
  fence: number
  workerId: string
  caseRevision: number
  documentVersion: number
  sha256: string
  type: string
  bytes: Buffer
  pages: number
}
export interface DocumentWorkerRepository {
  claim(workerId: string, leaseMs: number, maxAttempts: number): Promise<DocumentAttempt | null>
  heartbeat(attempt: DocumentAttempt, leaseMs: number): Promise<boolean>
  publish(attempt: DocumentAttempt, extraction: unknown, mode: 'live' | 'mock'): Promise<boolean>
  fail(
    attempt: DocumentAttempt,
    code: string,
    retryable: boolean,
    maxAttempts: number,
    automaticRetry?: boolean,
  ): Promise<boolean>
}

// Ports declare no implicit owner/verification: subject remains unresolved until a
// later authorized human decision. SQL/session/ACL checks are repository-owned.
export function projectDocument(row: StoredDocument): Record<string, unknown> {
  return {
    id: row.id,
    lineage: row.lineage,
    version: row.version,
    hash: row.hash,
    pages: row.pages,
    type: row.type,
    name: row.name,
    status: row.status,
    owner_party_ref: 'unresolved',
    source: {
      source_class: row.source_class,
      document_id: row.id,
      version: row.version,
      sha256: row.hash,
      ai_mode: row.ai_mode,
      subject_verification: 'unverified',
    },
    classification: { declared_type: row.type, verified: false },
    ...(row.source_review ? { source_review: row.source_review } : {}),
  }
}
