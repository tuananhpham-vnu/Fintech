import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UploadedFile,
  Body,
  UseInterceptors,
  HttpCode,
  Inject,
  Headers,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { createHash } from 'crypto'
import { FoundationError } from '../foundation/errors'
import type { FoundationRequest } from '../foundation/ports'
import { CoreRepository } from '../foundation/core.repository'
import {
  DOCUMENT_REPOSITORY,
  DOCUMENT_FILES,
  DOCUMENT_INSPECTOR,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_PAGES,
  DOCUMENT_TYPES,
} from './ports'
import type { DocumentRepository, DocumentFiles, DocumentInspector } from './ports'
import { DocumentAiError } from '../ai-adapters/document-ai-transport'
import { resolveLegacyEvidence } from './evidence-projection'
import { DocumentDecisions } from './document-decisions.service'
import { DocumentRetryService } from './document-retry.service'
import { extractionSummary } from './extraction-summary'

/** Local document slice only; no human verification or business workflow implied. */
@Controller()
export class DocumentsController {
  constructor(
    private readonly core: CoreRepository,
    @Inject(DOCUMENT_REPOSITORY) private readonly repository: DocumentRepository,
    @Inject(DOCUMENT_FILES) private readonly files: DocumentFiles,
    @Inject(DOCUMENT_INSPECTOR) private readonly inspector: DocumentInspector,
    private readonly decisions: DocumentDecisions,
    private readonly retries: DocumentRetryService,
  ) {}

  @Post('cases/:id/documents')
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 7, fieldSize: 1024 },
    }),
  )
  async upload(
    @Req() req: FoundationRequest & { headers: Record<string, any> },
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    // Authorize before invoking the provider or revealing source diagnostics.
    await this.core.case(req.user, id)
    const allowed = new Set([
      'type',
      'source_class',
      'mode',
      'expected_revision',
      'replaces_document_id',
      'response_request_id',
    ])
    if (
      !body ||
      Object.keys(body).some((k) => !allowed.has(k)) ||
      !file?.buffer ||
      !DOCUMENT_TYPES.includes(body.type as any) ||
      !['new', 'replace', 'response'].includes(body.mode as string) ||
      typeof body.source_class !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,64}$/.test(body.source_class) ||
      typeof body.expected_revision !== 'string' ||
      !/^[1-9][0-9]*$/.test(body.expected_revision) ||
      !Number.isSafeInteger(Number(body.expected_revision)) ||
      (body.mode === 'replace'
        ? typeof body.replaces_document_id !== 'string'
        : body.replaces_document_id !== undefined) ||
      (body.mode === 'response'
        ? typeof body.response_request_id !== 'string'
        : body.response_request_id !== undefined)
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new FoundationError(422, 'INVALID_IDEMPOTENCY_KEY')
    if (
      !file.buffer.length ||
      file.buffer.length > DOCUMENT_MAX_BYTES ||
      file.buffer.subarray(0, 5).toString() !== '%PDF-'
    )
      throw new FoundationError(422, 'INVALID_DOCUMENT')
    const displayName =
      file.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 200) || 'document.pdf'
    const sha256 = createHash('sha256').update(file.buffer).digest('hex')
    const input = {
      mode: body.mode as 'new' | 'replace' | 'response',
      type: body.type as any,
      sourceClass: body.source_class,
      expectedRevision: Number(body.expected_revision),
      replacesDocumentId: body.replaces_document_id as string,
      responseRequestId: body.response_request_id as string,
      displayName,
      bytes: file.buffer,
      sha256,
    }
    const replay = await this.repository.replay(req.session, id, key, input)
    if (replay) return replay.body
    const cached = await this.files.materialize(file.buffer, sha256)
    try {
      const inspected = await this.inspector.inspect(cached.storageKey, sha256)
      if (
        inspected.sha256 !== sha256 ||
        inspected.byte_size !== file.buffer.length ||
        inspected.page_count < 1 ||
        inspected.page_count > DOCUMENT_MAX_PAGES ||
        inspected.encrypted ||
        inspected.has_embedded_files
      )
        throw new FoundationError(422, 'DOCUMENT_INSPECTION_REJECTED')
      const result = await this.repository.accept(req.session, id, key, {
        ...input,
        pageCount: inspected.page_count,
        aiMode: inspected.mode,
      })
      return result.body
    } catch (error) {
      if (error instanceof DocumentAiError)
        throw new FoundationError(
          [404, 413, 422].includes(error.statusCode)
            ? error.statusCode
            : error.retryable
              ? 503
              : 502,
          error.code,
        )
      throw error
    } finally {
      await cached.release()
    }
  }

  @Get('jobs/:id')
  job(@Req() req: FoundationRequest, @Param('id') id: string) {
    return this.repository.job(req.session, id)
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  async retry(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.retries.retry(req.session, id, key, body)).body
  }

  @Get('documents/:id/source')
  async source(@Req() req: FoundationRequest, @Param('id') id: string, @Res() res: Response) {
    const { document, bytes } = await this.repository.read(req.session, id)
    if (
      bytes.length !== document.byte_size ||
      createHash('sha256').update(bytes).digest('hex') !== document.hash
    )
      throw new FoundationError(500, 'SOURCE_INTEGRITY_FAILURE')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"')
    res.setHeader('Content-Length', bytes.length)
    res.setHeader('X-Source-SHA256', document.hash)
    res.send(bytes)
  }

  @Get('documents/:id/extraction')
  async extraction(@Req() req: FoundationRequest, @Param('id') id: string) {
    const { document } = await this.repository.read(req.session, id)
    if (!document.extraction) throw new FoundationError(409, 'EXTRACTION_NOT_AVAILABLE')
    return (await this.decisions.projection(req.session, document)).fields
  }

  @Get('documents/:id/extraction-summary')
  async summary(@Req() req: FoundationRequest, @Param('id') id: string) {
    const { document } = await this.repository.read(req.session, id)
    return extractionSummary(document)
  }

  @Get('evidence/:id')
  async evidence(@Req() req: FoundationRequest, @Param('id') id: string) {
    const document = await this.repository.evidenceDocument(req.session, id)
    return resolveLegacyEvidence(document, document.extraction as any, id)
  }

  @Get('documents/:id/legacy-extraction')
  async legacyExtraction(@Req() req: FoundationRequest, @Param('id') id: string) {
    const { document } = await this.repository.read(req.session, id)
    if (!document.extraction) throw new FoundationError(409, 'EXTRACTION_NOT_AVAILABLE')
    // Return a labelled legacy envelope; never pass this raw shape off as AIC2 fields.
    return {
      document_id: id,
      document_version: document.version,
      source_hash: document.hash,
      ai_mode: document.ai_mode,
      schema_version: '1.0.2',
      verification: 'unverified',
      raw: document.extraction,
    }
  }

  @Post('documents/:id/classification')
  @HttpCode(200)
  async classify(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.decisions.decide(req.session, id, 'classification', key, body)).body
  }
  @Post('documents/:id/corrections')
  @HttpCode(200)
  async correct(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.decisions.decide(req.session, id, 'correction', key, body)).body
  }
  @Post('documents/:id/verification')
  @HttpCode(200)
  async verifyField(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.decisions.decide(req.session, id, 'verification', key, body)).body
  }
}
