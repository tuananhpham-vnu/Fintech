import type { StoredDocument } from './ports'
import { projectLegacyExtraction } from './evidence-projection'
import { suggestDocumentGroup } from './document-archive'

/** Machine-extraction diagnostics only; never implies human verification. */
export function extractionSummary(document: StoredDocument) {
  const raw = document.extraction as any
  const projection = raw ? projectLegacyExtraction(document, raw) : null
  const fields = projection?.fields ?? []
  const nonNull = fields.filter((field) => field.value !== null && field.value !== undefined)
  const usable = nonNull.filter((field) => field.evidence_refs.length > 0 &&
    field.value !== 'unknown' && field.quality !== 'unreadable')
  return {
    document_id: document.id, document_version: document.version, source_hash: document.hash,
    job_state: document.status, ai_mode: document.ai_mode, verification: 'unverified',
    ...suggestDocumentGroup(document.name), classification_verification: 'unverified',
    outcome: document.status === 'failed' ? 'failed' : !projection ? 'processing' :
      usable.length ? 'ready_for_review' : 'zero_usable_fields',
    total_fields: fields.length, non_null_fields: nonNull.length, usable_fields: usable.length,
    diagnostics: (raw?.diagnostics ?? []).map((d: any) => ({ code: d.code, field_key: d.field_key ?? null })),
    fields: fields.map((field) => ({ field_key: field.field_key, has_value: field.value !== null && field.value !== undefined,
      quality: field.quality, missing_reason: field.missing_reason, evidence_count: field.evidence_refs.length })),
  }
}
