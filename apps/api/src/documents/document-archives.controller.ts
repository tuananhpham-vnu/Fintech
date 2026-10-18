import { Body, Controller, HttpCode, Inject, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { createHash } from 'node:crypto'
import { FoundationError } from '../foundation/errors'
import { CoreRepository } from '../foundation/core.repository'
import type { FoundationRequest } from '../foundation/ports'
import { DocumentAiError } from '../ai-adapters/document-ai-transport'
import { PostgresDocumentRepository } from './postgres-document.repository'
import { DOCUMENT_FILES, DOCUMENT_INSPECTOR, DOCUMENT_MAX_PAGES } from './ports'
import type { DocumentFiles, DocumentInspector } from './ports'
import { ARCHIVE_MAX_BYTES, readZipArchive, suggestDocumentGroup } from './document-archive'
import type { PreparedArchiveItem } from './document-archive'

@Controller()
export class DocumentArchivesController {
  constructor(
    private readonly core: CoreRepository,
    private readonly repository: PostgresDocumentRepository,
    @Inject(DOCUMENT_FILES) private readonly files: DocumentFiles,
    @Inject(DOCUMENT_INSPECTOR) private readonly inspector: DocumentInspector,
  ) {}

  @Post('cases/:id/document-archives')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: ARCHIVE_MAX_BYTES, files: 1, fields: 1, fieldSize: 1024 },
  }))
  async uploadArchive(
    @Req() req: FoundationRequest & { headers: Record<string, unknown> },
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    await this.core.case(req.user, id)
    if (!body || Object.keys(body).some((key) => key !== 'expected_revision') ||
        typeof body.expected_revision !== 'string' || !/^[1-9][0-9]*$/.test(body.expected_revision) ||
        !Number.isSafeInteger(Number(body.expected_revision))) throw new FoundationError(422, 'INVALID_INPUT')
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new FoundationError(422, 'INVALID_IDEMPOTENCY_KEY')
    if (!file?.buffer?.length || !/\.zip$/i.test(file.originalname) ||
        !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype))
      throw new FoundationError(422, 'ARCHIVE_INVALID_ZIP')
    if (file.buffer.length > ARCHIVE_MAX_BYTES) throw new FoundationError(413, 'ARCHIVE_SIZE_LIMIT')
    const input = { sha256: createHash('sha256').update(file.buffer).digest('hex'),
                    expectedRevision: Number(body.expected_revision) }
    const replay = await this.repository.replayArchive(req.session, id, key, input)
    if (replay) return replay
    // Full security validation and bounded decompression before the first write.
    const deadline = Date.now() + 60_000
    const entries = await readZipArchive(file.buffer)
    const prepared: PreparedArchiveItem[] = []
    for (const entry of entries) {
      const item: PreparedArchiveItem = {
        entry_index: entry.entry_index, entry_path: entry.entry_path,
        ...suggestDocumentGroup(entry.entry_path), classification_verification: 'unverified',
        rejection: entry.rejection_code ? { code: entry.rejection_code, retryable: false } : null, upload: null,
      }
      prepared.push(item)
      if (item.rejection) continue
      if (Date.now() > deadline) {
        item.rejection = { code: 'ARCHIVE_INSPECTION_BUDGET', retryable: true }
        continue
      }
      const bytes = Buffer.from(entry.data, 'base64')
      // Recheck helper bindings at the boundary before native inspection/persistence.
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== entry.sha256 || bytes.length !== entry.byte_size || bytes.subarray(0, 5).toString() !== '%PDF-')
        throw new FoundationError(503, 'ARCHIVE_READER_INVALID_OUTPUT')
      const cached = await this.files.materialize(bytes, sha256)
      try {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          item.rejection = { code: 'ARCHIVE_INSPECTION_BUDGET', retryable: true }
          continue
        }
        const inspection = await this.inspector.inspect(cached.storageKey, sha256, remaining)
        if (inspection.sha256 !== sha256 || inspection.byte_size !== bytes.length ||
            inspection.page_count < 1 || inspection.encrypted || inspection.has_embedded_files) {
          item.rejection = { code: 'DOCUMENT_INSPECTION_REJECTED', retryable: false }
        } else if (inspection.page_count > DOCUMENT_MAX_PAGES) {
          item.rejection = { code: 'DOCUMENT_PAGE_LIMIT', retryable: false }
        } else {
          item.upload = { mode: 'new', type: item.suggested_type, sourceClass: 'archive_unverified',
            expectedRevision: input.expectedRevision,
            displayName: entry.entry_path.split('/').pop().slice(0, 200), bytes, sha256,
            pageCount: inspection.page_count, aiMode: inspection.mode }
        }
      } catch (error) {
        if (!(error instanceof DocumentAiError)) throw error
        item.rejection = { code: error.code, retryable: error.retryable }
      } finally {
        await cached.release()
      }
      // Release base64 as each bounded entry is prepared.
      entry.data = null
    }
    return this.repository.acceptArchive(req.session, id, key, input, prepared)
  }
}
