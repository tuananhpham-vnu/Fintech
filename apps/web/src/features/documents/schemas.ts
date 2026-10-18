import { ApiError } from '@/lib/api/client'
import { supportedDocumentTypes, type DocumentType } from '@/lib/api/contracts'

export type UploadMode = 'new' | 'replace' | 'response'
export type UploadDraft = {
  file: File | null
  type: DocumentType
  mode: UploadMode
  sourceClass: string
  target: string
  revision: number
}

/** Browser preflight only. Backend still inspects pages, encryption and case limits. */
export async function buildUploadForm(draft: UploadDraft): Promise<FormData> {
  const { file, type, mode, sourceClass, target, revision } = draft
  if (
    !file ||
    !file.name.toLowerCase().endsWith('.pdf') ||
    !['', 'application/pdf'].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new ApiError(422, 'INVALID_PDF', '')
  if (
    !supportedDocumentTypes.some((supported) => supported === type) ||
    !/^[A-Za-z0-9_.:-]{1,64}$/.test(sourceClass.trim()) ||
    (mode !== 'new' && !target)
  )
    throw new ApiError(422, 'INVALID_INPUT', '')
  if (new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-')
    throw new ApiError(415, 'INVALID_PDF', '')
  const form = new FormData()
  form.set('file', file)
  form.set('type', type)
  form.set('source_class', sourceClass.trim())
  form.set('mode', mode)
  form.set('expected_revision', String(revision))
  if (mode === 'replace') form.set('replaces_document_id', target)
  if (mode === 'response') form.set('response_request_id', target)
  return form
}
