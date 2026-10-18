import type { Document, DocumentType } from '@/lib/api/contracts'
import type { MessageKey } from '@/lib/i18n/messages'

export type DocumentGroupKey = 'bctc' | 'tax' | 'contract' | 'payment' | 'debt' | 'other'

export interface DocumentGroupDefinition {
  key: DocumentGroupKey
  titleKey: MessageKey
  types: DocumentType[]
}

export const DOCUMENT_GROUPS: DocumentGroupDefinition[] = [
  {
    key: 'bctc',
    titleKey: 'groupBctc',
    types: ['financial_statement'],
  },
  {
    key: 'tax',
    titleKey: 'groupTax',
    types: ['tax_report', 'invoice'],
  },
  {
    key: 'contract',
    titleKey: 'groupContract',
    types: ['contract', 'loan_request', 'registration'],
  },
  {
    key: 'payment',
    titleKey: 'groupPayment',
    types: ['payment_record', 'acceptance_record'],
  },
  {
    key: 'debt',
    titleKey: 'groupDebt',
    types: ['debt_instrument', 'delivery_record', 'collateral_document'],
  },
  {
    key: 'other',
    titleKey: 'groupOther',
    types: ['other'],
  },
]

/** Maps a document type to its primary visual 6-group key. */
export function resolveDocumentGroup(type: DocumentType): DocumentGroupKey {
  for (const group of DOCUMENT_GROUPS) {
    if (group.types.includes(type)) return group.key
  }
  return 'other'
}

/** Determines the effective type for grouping, prioritizing human confirmation. */
export function getEffectiveDocumentType(doc: Document): DocumentType {
  return doc.source_review?.declared_type ?? doc.type
}

/** Counts usable extracted fields for a document (value not null, quality not 'missing'). */
export function countUsableExtractedFields(doc: Document): number {
  if (!doc.extraction || !Array.isArray(doc.extraction)) return 0
  return doc.extraction.filter((f) => f.value !== null && f.quality !== 'missing').length
}

export interface GroupedDocuments {
  key: DocumentGroupKey
  titleKey: MessageKey
  documents: Document[]
  actionCount?: number
}

export interface DocumentPeriodInfo {
  year: string | null
  isVerified: boolean
  source: 'field' | 'suggestion' | 'filename' | 'none'
}

/**
 * Resolves period / fiscal year from document metadata.
 * Business Rule (§2.1): Only mark as verified if backed by extracted evidence.
 * Heuristic/filename predictions must be marked unverified (Dự đoán).
 */
export function resolveDocumentPeriod(doc: Document): DocumentPeriodInfo {
  // 1. Check extracted fields for verified period
  if (doc.extraction && Array.isArray(doc.extraction)) {
    for (const f of doc.extraction) {
      if (f.value !== null && f.evidence_refs?.length > 0) {
        if (f.period) {
          const match = f.period.match(/(?:^|\D)(20[12]\d)(?:\D|$)/)
          if (match) {
            return { year: match[1], isVerified: true, source: 'field' }
          }
        }
        if (f.field_key && f.field_key.includes('period') && typeof f.value === 'string') {
          const match = f.value.match(/(?:^|\D)(20[12]\d)(?:\D|$)/)
          if (match) {
            return { year: match[1], isVerified: true, source: 'field' }
          }
        }
      }
    }
  }

  // 2. Check period_suggestion if present on document
  const rawDoc = doc as unknown as Record<string, unknown>
  if (rawDoc.period_suggestion && typeof rawDoc.period_suggestion === 'object') {
    const ps = rawDoc.period_suggestion as Record<string, unknown>
    if (ps.year && Number.isInteger(ps.year)) {
      return {
        year: String(ps.year),
        isVerified: ps.verification === 'verified',
        source: 'suggestion',
      }
    }
  }

  // 3. Filename hint (unverified prediction)
  if (doc.name) {
    const match = doc.name.match(/(?:^|\D)(20[12]\d)(?:\D|$)/)
    if (match) {
      return { year: match[1], isVerified: false, source: 'filename' }
    }
  }

  return { year: null, isVerified: false, source: 'none' }
}

export type ActionRequiredReasonKey =
  | 'failed'
  | 'rejected'
  | 'needs_review'
  | 'noUsableFields'
  | 'unconfirmed'
  | 'needsClassification'
  | 'unresolved'

export interface ActionRequiredInfo {
  required: boolean
  reasonKey: ActionRequiredReasonKey | null
  tone: 'red' | 'amber' | 'neutral'
}

/** Determines if a document requires specialist action. */
export function getDocumentActionRequired(doc: Document): ActionRequiredInfo {
  const raw = doc as unknown as Record<string, unknown>
  if (doc.status === 'failed' || raw.dossier_processing_state === 'failed') {
    return { required: true, reasonKey: 'failed', tone: 'red' }
  }
  if (doc.status === 'rejected' || raw.dossier_intake_state === 'rejected') {
    return { required: true, reasonKey: 'rejected', tone: 'red' }
  }
  if (
    doc.status === 'needs_review' ||
    raw.dossier_intake_state === 'needs_review' ||
    raw.dossier_processing_state === 'needs_review' ||
    raw.dossier_error_code === 'PDF_REQUIRES_CHUNKED_PROCESSING'
  ) {
    return { required: true, reasonKey: 'needs_review', tone: 'amber' }
  }
  if (doc.status === 'completed' && countUsableExtractedFields(doc) === 0) {
    return { required: true, reasonKey: 'noUsableFields', tone: 'amber' }
  }
  if (!doc.source_review?.declared_type) {
    return { required: true, reasonKey: 'unconfirmed', tone: 'amber' }
  }
  if (doc.type === 'other' && (!doc.source_review || doc.source_review.declared_type === 'other')) {
    return { required: true, reasonKey: 'needsClassification', tone: 'amber' }
  }
  if (
    doc.source_review?.subject_match === 'mismatch' ||
    doc.source_review?.subject_match === 'unresolved'
  ) {
    return { required: true, reasonKey: 'unresolved', tone: 'neutral' }
  }
  return { required: false, reasonKey: null, tone: 'neutral' }
}

export function isDocumentActionRequired(doc: Document): boolean {
  return getDocumentActionRequired(doc).required
}

export interface YearGroupedDocuments {
  key: string
  year: string | null
  title: string
  isUnspecified: boolean
  documents: Document[]
  actionCount: number
}

/** Groups documents by fiscal year (descending order) with an Unspecified group at the end. */
export function groupDocumentsByYear(documents: Document[]): YearGroupedDocuments[] {
  const map = new Map<string, Document[]>()
  const unspecified: Document[] = []

  for (const doc of documents) {
    const period = resolveDocumentPeriod(doc)
    if (period.year) {
      const list = map.get(period.year) ?? []
      list.push(doc)
      map.set(period.year, list)
    } else {
      unspecified.push(doc)
    }
  }

  // Sort distinct years descending
  const sortedYears = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))

  const result: YearGroupedDocuments[] = sortedYears.map((year) => {
    const docs = map.get(year)!
    const actionCount = docs.filter(isDocumentActionRequired).length
    return {
      key: `year-${year}`,
      year,
      title: `Năm ${year}`,
      isUnspecified: false,
      documents: docs,
      actionCount,
    }
  })

  if (unspecified.length > 0) {
    const actionCount = unspecified.filter(isDocumentActionRequired).length
    result.push({
      key: 'year-unspecified',
      year: null,
      title: 'Chưa xác định',
      isUnspecified: true,
      documents: unspecified,
      actionCount,
    })
  }

  return result
}

export interface DocumentFilterOptions {
  search?: string
  groupBy?: 'year' | 'type'
  actionRequiredOnly?: boolean
  yearFilter?: string | null
  typeFilter?: DocumentType | 'all' | null
  statusFilter?:
    | 'all'
    | 'usable'
    | 'zero_usable'
    | 'processing'
    | 'failed'
    | 'needs_review'
    | 'rejected'
    | 'unconfirmed'
    | null
}

/** Filters a list of documents according to search query, facets, and action-required status. */
export function filterDocuments(documents: Document[], options: DocumentFilterOptions): Document[] {
  let list = documents

  // Filter: Action Required only
  if (options.actionRequiredOnly) {
    list = list.filter(isDocumentActionRequired)
  }

  // Filter: Year facet
  if (options.yearFilter && options.yearFilter !== 'all') {
    if (options.yearFilter === 'unspecified') {
      list = list.filter((doc) => resolveDocumentPeriod(doc).year === null)
    } else {
      list = list.filter((doc) => resolveDocumentPeriod(doc).year === options.yearFilter)
    }
  }

  // Filter: Type facet
  if (options.typeFilter && options.typeFilter !== 'all') {
    list = list.filter((doc) => getEffectiveDocumentType(doc) === options.typeFilter)
  }

  // Filter: Status facet
  if (options.statusFilter && options.statusFilter !== 'all') {
    if (options.statusFilter === 'usable') {
      list = list.filter((doc) => doc.status === 'completed' && countUsableExtractedFields(doc) > 0)
    } else if (options.statusFilter === 'zero_usable') {
      list = list.filter(
        (doc) => doc.status === 'completed' && countUsableExtractedFields(doc) === 0,
      )
    } else if (options.statusFilter === 'processing') {
      list = list.filter((doc) => ['processing', 'running', 'queued'].includes(doc.status))
    } else if (options.statusFilter === 'failed') {
      list = list.filter((doc) => doc.status === 'failed')
    } else if (options.statusFilter === 'needs_review') {
      list = list.filter(
        (doc) =>
          doc.status === 'needs_review' ||
          (doc as unknown as Record<string, unknown>).dossier_intake_state === 'needs_review' ||
          (doc as unknown as Record<string, unknown>).dossier_processing_state === 'needs_review' ||
          (doc as unknown as Record<string, unknown>).dossier_error_code ===
            'PDF_REQUIRES_CHUNKED_PROCESSING',
      )
    } else if (options.statusFilter === 'rejected') {
      list = list.filter(
        (doc) =>
          doc.status === 'rejected' ||
          (doc as unknown as Record<string, unknown>).dossier_intake_state === 'rejected',
      )
    } else if (options.statusFilter === 'unconfirmed') {
      list = list.filter((doc) => !doc.source_review)
    }
  }

  // Filter: Search query
  if (options.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase()
    list = list.filter((doc) => {
      const name = (doc.name ?? '').toLowerCase()
      const type = (doc.type ?? '').toLowerCase()
      const effectiveType = getEffectiveDocumentType(doc).toLowerCase()
      const period = resolveDocumentPeriod(doc).year ?? ''
      return (
        name.includes(q) ||
        type.includes(q) ||
        effectiveType.includes(q) ||
        period.includes(q) ||
        doc.id.toLowerCase().includes(q)
      )
    })
  }

  return list
}

/** Groups a list of documents into the 6 standard visual categories. */
export function groupDocuments(documents: Document[]): GroupedDocuments[] {
  const map = new Map<DocumentGroupKey, Document[]>()
  for (const group of DOCUMENT_GROUPS) {
    map.set(group.key, [])
  }

  for (const doc of documents) {
    const effectiveType = getEffectiveDocumentType(doc)
    const groupKey = resolveDocumentGroup(effectiveType)
    const list = map.get(groupKey) ?? map.get('other')!
    list.push(doc)
  }

  return DOCUMENT_GROUPS.map((group) => {
    const docs = map.get(group.key) ?? []
    const actionCount = docs.filter(isDocumentActionRequired).length
    return {
      key: group.key,
      titleKey: group.titleKey,
      documents: docs,
      actionCount,
    }
  })
}

export interface IngestionSummary {
  totalFiles: number
  usableFiles: number
  zeroUsableFiles: number
  processingFiles: number
  failedFiles: number
  unconfirmedFiles: number
  nextStepKey: MessageKey
}

/** Computes honest summary metrics for the SME officer. */
export function computeIngestionSummary(documents: Document[]): IngestionSummary {
  const totalFiles = documents.length
  let usableFiles = 0
  let zeroUsableFiles = 0
  let processingFiles = 0
  let failedFiles = 0
  let unconfirmedFiles = 0

  for (const doc of documents) {
    if (!doc.source_review) {
      unconfirmedFiles++
    }

    const raw = doc as unknown as Record<string, unknown>
    if (doc.status === 'completed') {
      const usable = countUsableExtractedFields(doc)
      if (usable > 0) {
        usableFiles++
      } else {
        zeroUsableFiles++
      }
    } else if (
      ['processing', 'running', 'queued'].includes(doc.status) ||
      ['processing', 'running', 'queued', 'waiting'].includes(
        raw.dossier_processing_state as string,
      )
    ) {
      processingFiles++
    } else if (doc.status === 'failed' || raw.dossier_processing_state === 'failed') {
      failedFiles++
    }
  }

  let nextStepKey: MessageKey = 'nextStepUpload'
  if (totalFiles === 0) {
    nextStepKey = 'nextStepUpload'
  } else if (unconfirmedFiles > 0) {
    nextStepKey = 'nextStepClassify'
  } else if (usableFiles > 0) {
    nextStepKey = 'nextStepReviewFields'
  } else {
    nextStepKey = 'nextStepFinancial'
  }

  return {
    totalFiles,
    usableFiles,
    zeroUsableFiles,
    processingFiles,
    failedFiles,
    unconfirmedFiles,
    nextStepKey,
  }
}
