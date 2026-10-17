import type { ValidatedLegacyResponse } from '../ai-adapters/legacy-validation'
import type { StoredDocument } from './ports'

/** Labels the source vocabulary; this is not an AIC2 business field registry. */
export const LEGACY_FIELD_KEY_PREFIX = 'legacy:1.0.2:'

/** Structural read shape consumed by the current FE; no frontend dependency. */
export interface FEExtractedField {
  field_key: string
  value: unknown
  raw_value: unknown
  quality: string
  missing_reason: string | null
  evidence_refs: string[]
}

export interface Evidence {
  id: string
  document_id: string
  document_version: number
  page: number
  quote: string
  source_hash: string
  bbox?: number[] | null
}

export interface EvidenceProjection {
  fields: FEExtractedField[]
  evidence: Evidence[]
  raw: ValidatedLegacyResponse['body']
}

export type EvidenceProjectionErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_EXTRACTION'
  | 'SOURCE_MISMATCH'
  | 'INVALID_PAGE'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_EVIDENCE_REFERENCE'
  | 'MISSING_EVIDENCE_REFERENCE'
  | 'EVIDENCE_NOT_FOUND'

export class EvidenceProjectionError extends Error {
  constructor(readonly code: EvidenceProjectionErrorCode) {
    super(`Legacy evidence projection failed: ${code}`)
    this.name = 'EvidenceProjectionError'
  }
}

function fail(code: EvidenceProjectionErrorCode): never {
  throw new EvidenceProjectionError(code)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}
function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  )
}
function uniqueId(value: unknown, seen: Set<string>): asserts value is string {
  if (!uuid(value)) fail('INVALID_ID')
  // UUIDs differing only in hex case are the same database identity. Preserve
  // spelling on output, but never let aliases evade the duplicate guard.
  const identity = value.toLowerCase()
  if (seen.has(identity)) fail('DUPLICATE_ID')
  seen.add(identity)
}

/**
 * Pure, explicit legacy 1.0.2 -> current FE read projection. Call AFTER canonical
 * legacy validation, using the repository's unchanged validated .body and its
 * authoritative, exact StoredDocument row (not a lineage's latest version).
 * This checks source/ref/page bindings again; it does not replace full canonical
 * validation, ACLs, repository selection or persisted-version immutability.
 *
 * Raw is returned by identity, including every page, original field, evidence,
 * precision, diagnostic and provenance entry. Projection arrays and nested values
 * are independent copies. No input is modified, frozen, normalized or enriched.
 * Unknown legacy field keys remain displayable in an explicit legacy namespace.
 * No v1 registry lookup, identity/party inference, classification approval, score,
 * verified status or effective-field correction is performed. Canonical 1.0.2
 * has no party_role/period/currency attributes on fields: original role labels
 * in keys and values survive verbatim; those optional FE attributes are not guessed.
 */
export function projectLegacyExtraction(
  document: StoredDocument,
  raw: ValidatedLegacyResponse['body'],
): EvidenceProjection {
  if (
    !document ||
    !uuid(document.id) ||
    !uuid(document.case_id) ||
    !positive(document.version) ||
    !positive(document.pages) ||
    typeof document.hash !== 'string' ||
    document.hash.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(document.hash)
  )
    fail('INVALID_DOCUMENT')
  if (
    !object(raw) ||
    raw.schema_version !== '1.0.2' ||
    !Array.isArray(raw.pages) ||
    !Array.isArray(raw.fields) ||
    !Array.isArray(raw.evidence)
  )
    fail('INVALID_EXTRACTION')
  if (
    raw.document_id !== document.id ||
    raw.sha256 !== document.hash ||
    raw.case_id !== document.case_id
  )
    fail('SOURCE_MISMATCH')

  const pages = new Set<number>()
  for (let index = 0; index < raw.pages.length; index++) {
    const page = raw.pages[index]
    if (
      !object(page) ||
      !positive(page.page) ||
      page.page !== index + 1 ||
      page.page > document.pages
    )
      fail('INVALID_PAGE')
    pages.add(page.page)
  }

  const sourceIds = new Set<string>()
  const exactSources = new Set<string>()
  const evidence = raw.evidence.map((source): Evidence => {
    if (!object(source)) fail('INVALID_EXTRACTION')
    uniqueId(source.id, sourceIds)
    if (source.document_id !== document.id) fail('SOURCE_MISMATCH')
    if (!positive(source.page) || !pages.has(source.page) || source.page > document.pages)
      fail('INVALID_PAGE')
    if (
      typeof source.quote !== 'string' ||
      source.quote.length === 0 ||
      !['page', 'bbox'].includes(source.precision as string) ||
      !(
        source.bbox === null ||
        (Array.isArray(source.bbox) &&
          source.bbox.length === 4 &&
          source.bbox.every(
            (coordinate) =>
              typeof coordinate === 'number' &&
              Number.isFinite(coordinate) &&
              coordinate >= 0 &&
              coordinate <= 1,
          ))
      )
    )
      fail('INVALID_EXTRACTION')
    exactSources.add(source.id)
    return {
      id: source.id,
      document_id: document.id,
      document_version: document.version,
      page: source.page,
      quote: source.quote,
      source_hash: document.hash,
      bbox: source.bbox === null ? null : [...(source.bbox as number[])],
    }
  })

  const fieldIds = new Set<string>()
  const fieldKeys = new Set<string>()
  const fields = raw.fields.map((field): FEExtractedField => {
    if (!object(field)) fail('INVALID_EXTRACTION')
    uniqueId(field.id, fieldIds)
    if (typeof field.field_key === 'string' && fieldKeys.has(field.field_key)) fail('DUPLICATE_ID')
    if (typeof field.field_key === 'string') fieldKeys.add(field.field_key)
    if (field.document_id !== document.id) fail('SOURCE_MISMATCH')
    if (
      typeof field.field_key !== 'string' ||
      !['readable', 'uncertain', 'unreadable'].includes(field.quality as string) ||
      !(field.raw_value === null || typeof field.raw_value === 'string') ||
      !Object.hasOwn(field, 'value') ||
      !(
        field.missing_reason === null ||
        ['not_present', 'unreadable', 'ambiguous', 'out_of_scope'].includes(
          field.missing_reason as string,
        )
      ) ||
      !Array.isArray(field.evidence_ids)
    )
      fail('INVALID_EXTRACTION')
    const seen = new Set<string>()
    const evidenceRefs = field.evidence_ids.map((id): string => {
      if (!uuid(id)) fail('INVALID_ID')
      if (seen.has(id.toLowerCase())) fail('DUPLICATE_EVIDENCE_REFERENCE')
      seen.add(id.toLowerCase())
      // Exact source ID only. Never normalize, mint a replacement, search other
      // documents, infer from quote text, or silently drop an unresolved ref.
      if (!exactSources.has(id)) fail('MISSING_EVIDENCE_REFERENCE')
      return id
    })
    let value: unknown
    try {
      value = structuredClone(field.value)
    } catch {
      fail('INVALID_EXTRACTION')
    }
    return {
      field_key: `${LEGACY_FIELD_KEY_PREFIX}${field.field_key}`,
      value,
      raw_value: field.raw_value,
      quality: field.quality as string,
      missing_reason: field.missing_reason as string | null,
      evidence_refs: evidenceRefs,
    }
  })
  return { fields, evidence, raw }
}

/** Resolve only within this exact authorized document's validated extraction. */
export function resolveLegacyEvidence(
  document: StoredDocument,
  raw: ValidatedLegacyResponse['body'],
  evidenceId: string,
): Evidence {
  if (!uuid(evidenceId)) fail('INVALID_ID')
  const projected = projectLegacyExtraction(document, raw)
  const source = projected.evidence.find((item) => item.id === evidenceId)
  if (!source) fail('EVIDENCE_NOT_FOUND')
  return source
}
