import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { FoundationError } from '../foundation/errors'
import type { DocumentType, DocumentUpload } from './ports'

export const ARCHIVE_MAX_BYTES = 20 * 1024 * 1024
export type DocumentGroup = 'financial_statements' | 'contracts' | 'tax' | 'payments' | 'other'
export interface ArchiveEntry {
  entry_index: number
  entry_path: string
  byte_size: number
  sha256: string | null
  rejection_code: string | null
  data: string | null
}
export interface PreparedArchiveItem {
  entry_index: number
  entry_path: string
  group: DocumentGroup
  suggested_type: DocumentType
  classification_verification: 'unverified'
  rejection: { code: string; retryable: boolean } | null
  upload: DocumentUpload | null
}
export interface ArchiveInput {
  sha256: string
  expectedRevision: number
}

/** Filename suggestion only: no party, period, financial or payment inference. */
export function suggestDocumentGroup(name: string): { group: DocumentGroup; suggested_type: DocumentType } {
  const text = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[_-]+/g, ' ')
  if (/\b(bctc|financial[ _-]?statements?|balance[ _-]?sheet)\b|bao[ _-]?cao[ _-]?tai[ _-]?chinh/.test(text))
    return { group: 'financial_statements', suggested_type: 'financial_statement' }
  if (/\b(contract|hop[ _-]?dong)\b/.test(text)) return { group: 'contracts', suggested_type: 'contract' }
  if (/\b(tax|thue|gtgt)\b|to[ _-]?khai/.test(text)) return { group: 'tax', suggested_type: 'other' }
  // Invoice is not evidence of a payment.
  if (/\b(invoice)\b|hoa[ _-]?don/.test(text)) return { group: 'other', suggested_type: 'invoice' }
  if (/\b(payment|unc|receipt)\b|thanh[ _-]?toan|chuyen[ _-]?khoan/.test(text))
    return { group: 'payments', suggested_type: 'payment_record' }
  return { group: 'other', suggested_type: 'other' }
}

let readers = 0
let dossierReaders = 0
/** No shell, temp files, environment/config reads or network in the isolated helper. */
export async function readZipArchive(bytes: Buffer, profile: 'legacy' | 'dossier' = 'legacy'): Promise<ArchiveEntry[]> {
  const dossier = profile === 'dossier'
  if (dossier && dossierReaders >= 1) throw new FoundationError(503, 'ARCHIVE_READER_BUSY')
  if (readers >= 2) throw new FoundationError(503, 'ARCHIVE_READER_BUSY')
  if (bytes.length > (dossier ? 32 * 1024 * 1024 : ARCHIVE_MAX_BYTES)) throw new FoundationError(413, 'ARCHIVE_SIZE_LIMIT')
  readers++
  if (dossier) dossierReaders++
  try {
    const root = resolve(__dirname, '../../../..')
    const localPython = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const python = existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python.exe' : 'python3'
    return await new Promise((done, reject) => {
      const child = spawn(python, ['-I', '-B', resolve(root, 'services/ai/scripts/demo_zip_reader.py'), ...(dossier ? ['--dossier'] : [])], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Deliberately exclude provider keys and application secrets.
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
          /^(PATH|SystemRoot|WINDIR|TEMP|TMP|LANG|LC_ALL)$/i.test(key))),
      })
      let count = 0, finished = false
      const parts: Buffer[] = []
      const fail = (code: string, status = 503) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        child.kill()
        reject(new FoundationError(status, code))
      }
      const timer = setTimeout(() => fail('ARCHIVE_READER_TIMEOUT'), dossier ? 30_000 : 15_000)
      child.on('error', () => fail('ARCHIVE_READER_UNAVAILABLE'))
      child.stdin.on('error', () => fail('ARCHIVE_READER_UNAVAILABLE'))
      child.stderr.resume() // discard; never log raw parser/member text
      child.stdout.on('data', (chunk: Buffer) => {
        count += chunk.length
        if (count > (dossier ? 96 : 60) * 1024 * 1024) return fail('ARCHIVE_READER_LIMIT', 413)
        parts.push(chunk)
      })
      child.on('close', (code) => {
        if (finished) return
        clearTimeout(timer)
        finished = true
        if (code !== 0) return reject(new FoundationError(503, 'ARCHIVE_READER_UNAVAILABLE'))
        try {
          const result = JSON.parse(Buffer.concat(parts).toString('utf8'))
          if (typeof result.error === 'string' && /^ARCHIVE_[A-Z_]+$/.test(result.error))
            return reject(new FoundationError(result.error.includes('LIMIT') ? 413 : 422, result.error))
          if (!Array.isArray(result.items) || result.items.length > (dossier ? 128 : 32))
            throw new Error('Invalid reader output')
          done(result.items)
        } catch {
          reject(new FoundationError(503, 'ARCHIVE_READER_INVALID_OUTPUT'))
        }
      })
      child.stdin.end(bytes)
    })
  } finally {
    readers--
    if (dossier) dossierReaders--
  }
}
