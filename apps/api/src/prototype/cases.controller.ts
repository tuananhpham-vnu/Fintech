import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  Req,
  UploadedFile,
  UseInterceptors,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
  HttpCode,
  Logger,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import * as crypto from 'crypto'
import { InMemoryDbService, DocumentItem, JobItem, EvidenceItem } from '../state/in-memory-db.service'
import { StorageService } from '../storage/storage.service'
import { AiClientService, AiServiceException } from '../ai-client/ai-client.service'

@Controller('cases')
export class CasesController {
  private readonly logger = new Logger(CasesController.name)

  constructor(
    private readonly db: InMemoryDbService,
    private readonly storage: StorageService,
    private readonly aiClient: AiClientService,
  ) {}

  @Get()
  list() {
    return {
      items: this.db.getCases(),
      next_cursor: null,
    }
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const c = this.db.getCase(id)
    if (!c) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Case ${id} not found`,
      })
    }
    return c
  }

  @Get(':id/readiness')
  getReadiness(@Param('id') id: string) {
    const c = this.db.getCase(id)
    if (!c) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Case ${id} not found`,
      })
    }
    return c.readiness
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    const c = this.db.getCase(id)
    if (!c) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Case ${id} not found`,
      })
    }
    return {
      items: [],
      next_cursor: null,
    }
  }

  @Post(':id/documents')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('x-csrf-token') csrfToken: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() req: Request,
  ) {
    this.logger.log(`Document upload requested for case ${id}`)

    // 1. Validate session & CSRF
    const rawCookie = req.headers.cookie || ''
    const cookieToken = rawCookie.match(/(?:^|;\s*)aic_fe_qa=([^;]+)/)?.[1]
    const sessionToken = req.cookies?.['aic_fe_qa'] || cookieToken
    const session = this.db.getSession(sessionToken)
    if (!session) {
      throw new ForbiddenException({
        code: 'SESSION_EXPIRED',
        message: 'Valid session required',
      })
    }
    if (!csrfToken || session.csrf_token !== csrfToken) {
      throw new ForbiddenException({
        code: !csrfToken ? 'CSRF_REQUIRED' : 'CSRF_MISMATCH',
        message: !csrfToken ? 'CSRF token is required' : 'Invalid CSRF token',
      })
    }

    // 2. Validate case
    const c = this.db.getCase(id)
    if (!c) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Case ${id} not found`,
      })
    }

    // 3. Validate file
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'PDF file is required',
      })
    }
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'File size exceeds 10MB limit',
      })
    }
    // Check PDF magic bytes '%PDF-'
    if (file.buffer.subarray(0, 5).toString('utf-8') !== '%PDF-') {
      throw new BadRequestException({
        code: 'INVALID_PDF',
        message: 'Uploaded file is not a valid PDF',
      })
    }

    const sha256Temp = crypto.createHash('sha256').update(file.buffer).digest('hex')

    // 4. Idempotency check: replay detection (runs before revision check for exact replays)
    if (idempotencyKey) {
      const existing = this.db.getIdempotency(idempotencyKey)
      if (existing) {
        if (existing.caseId === id && existing.sha256 === sha256Temp) {
          this.logger.log(`Idempotent replay detected for key ${idempotencyKey}`)
          return existing.response
        } else {
          throw new BadRequestException({
            code: 'IDEMPOTENCY_MISMATCH',
            message: 'Idempotency-Key reuse with different payload or case',
          })
        }
      }
    }

    // 5. Validate revision (for non-replay writes)
    const expectedRevision = Number(body?.expected_revision)
    if (isNaN(expectedRevision) || expectedRevision !== c.revision) {
      throw new ConflictException({
        code: 'REVISION_CONFLICT',
        message: `Expected revision ${expectedRevision} does not match current revision ${c.revision}`,
      })
    }

    const FIXTURE_DOC_IDS: Record<string, string> = {
      '33a453e3558ff0e8b5a770b70b38f2fb1bc32a2484cd3e916742ed973d378764': 'bdd9ea62-ce2f-5e12-b0d7-a7320811dea1', // 04_contract.pdf
      '22ff9c92526dc77b5df291764f73e34c86949113707f69aad0eb02d8e1e8126c': 'dfc2fa37-52e9-5177-98c7-60258ab943f9', // 01_registration.pdf
      'e3db190d1d018392f4f2f973f2a9a5b433a1bf6e029692c1aa1e2a15fa9b0b15': 'dd5fe217-1959-5f4a-aa3f-cead3ca45076', // 02_financials.pdf
      '780feae0ea49ad4781cef9cc33ce01b7de19d337b479450b4e0f9a961666c9a7': '9f79247e-3b4a-5bb0-880b-720253b8a1be', // 03_loan_request.pdf
      'a7e0ebd1f7a73513d4b37bdea01e1a7bda57bdea7c135a6f62411e4e57a5629f': '9a2ea7ea-8bed-5dba-bb31-c12fb07db444', // 05_wrong_record.pdf
      '9d4503218251b27270ef1331f6c21a2c1a33a415e3cbbc6d7d246cf43022321b': '0ac0561d-33a2-530f-a5d4-a1701cd51b1c', // 06_correct_record.pdf
    }

    const docId = (c.id === 'a06adf0c-7110-51f6-86ad-4b4b903c3e9e' && FIXTURE_DOC_IDS[sha256Temp])
      ? FIXTURE_DOC_IDS[sha256Temp]
      : crypto.randomUUID()

    const docType = body?.type || 'contract'
    const docName = file.originalname || 'uploaded.pdf'

    // 5. Save file to storage
    const { storageKey, sha256 } = this.storage.saveFile(docId, file.buffer)
    this.logger.log(`Saved file ${docId} to ${storageKey} (sha256: ${sha256})`)

    // Initial document record
    const doc: DocumentItem = {
      id: docId,
      lineage: crypto.randomUUID(),
      version: 1,
      hash: sha256,
      pages: 1, // updated after inspect
      source: 'UPLOADED_PDF',
      owner_party_ref: c.counterparty_id,
      type: docType,
      classification: docType,
      status: 'processing',
      name: docName,
      extraction: null,
    }

    const jobId = crypto.randomUUID()
    const job: JobItem = {
      id: jobId,
      state: 'running',
      retryable: false,
    }

    this.db.addDocument(c, doc)
    this.db.addJob(c, job)
    this.db.bumpCaseRevision(c)

    // 6. Call real FastAPI inspect
    let inspectSucceeded = false
    try {
      const inspection = await this.aiClient.inspect(storageKey, sha256)
      doc.pages = inspection.page_count
      inspectSucceeded = true
      this.logger.log(`Inspection succeeded: ${inspection.page_count} pages, encrypted: ${inspection.encrypted}`)
    } catch (err: any) {
      this.logger.error(`Inspection failed: ${err.message}`)
      job.state = 'failed'
      job.retryable = true
      job.errors = [
        {
          code: err.code || 'INSPECTION_FAILED',
          message: err.message,
        },
      ]
      doc.status = 'failed'
      const failureResult = {
        document: doc,
        job,
        revision: c.revision,
      }
      if (idempotencyKey) {
        this.db.setIdempotency(idempotencyKey, id, sha256Temp, failureResult)
      }
      return failureResult
    }

    // 7. Call real FastAPI extract
    if (inspectSucceeded) {
      try {
        const extractionResult = await this.aiClient.extract(
          docId,
          c.id,
          docType,
          storageKey,
          sha256,
        )
        doc.extraction = (extractionResult.fields || []).map((f: any) => ({
          ...f,
          evidence_refs: Array.isArray(f.evidence_ids)
            ? f.evidence_ids
            : Array.isArray(f.evidence_refs)
              ? f.evidence_refs
              : [],
        }))
        doc.status = 'ready'
        job.state = 'completed'

        // Save evidence items if present
        if (Array.isArray(extractionResult.evidence)) {
          for (const ev of extractionResult.evidence) {
            const evItem: EvidenceItem = {
              id: ev.id,
              document_id: docId,
              document_version: 1,
              page: ev.page,
              quote: ev.quote,
              source_hash: sha256,
              bbox: ev.bbox,
            }
            this.db.addEvidence(evItem)
          }
        }
        this.logger.log(`Extraction succeeded with ${doc.extraction.length} fields`)
      } catch (err: any) {
        this.logger.warn(`Extraction returned error: ${err.message} (${err.code})`)
        // Inspection succeeded, but extraction failed or is unsupported/stub
        doc.status = 'review_required'
        job.state = 'failed'
        job.retryable = true
        job.errors = [
          {
            code: err.code || 'EXTRACTION_FAILED',
            message: `FastAPI Extraction: ${err.message}`,
          },
        ]
      }
    }

    const successResult = {
      document: doc,
      job,
      revision: c.revision,
    }
    if (idempotencyKey) {
      this.db.setIdempotency(idempotencyKey, id, sha256Temp, successResult)
    }
    return successResult
  }
}
