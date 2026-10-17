import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Post,
  Patch,
  Inject,
  Optional,
  Body,
  Headers,
  HttpCode,
} from '@nestjs/common'
import { CoreRepository } from '../foundation/core.repository'
import { FoundationRequest } from '../foundation/ports'
import { FoundationError } from '../foundation/errors'
import { DOCUMENT_REPOSITORY, projectDocument } from '../documents/ports'
import type { DocumentRepository } from '../documents/ports'
import { MvpCaseService } from '../foundation/mvp-case.service'
import { MvpWorkflowService } from '../foundation/mvp-workflow.service'
import { DocumentDecisions } from '../documents/document-decisions.service'

@Controller('cases')
export class CasesController {
  constructor(
    private readonly core: CoreRepository,
    @Optional() @Inject(DOCUMENT_REPOSITORY) private readonly documents?: DocumentRepository,
    @Optional() private readonly mutations?: MvpCaseService,
    @Optional() private readonly workflows?: MvpWorkflowService,
    @Optional() private readonly decisions?: DocumentDecisions,
  ) {}
  @Get() list(@Req() req: FoundationRequest, @Query() query: unknown) {
    return this.core.cases(req.user, query)
  }
  @Get(':id') async getOne(@Req() req: FoundationRequest, @Param('id') id: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.core.case(req.user, id)
      if (!this.documents) return result
      const rows = await this.documents.list(req.session, id)
      const jobs = await this.documents.listJobs(req.session, id)
      const workflows = this.workflows ? await this.workflows.detail(req.session, id) : {}
      const documents = await Promise.all(
        rows
          .filter((row) => row.active)
          .map(async (row) => ({
            ...projectDocument(row),
            ...(row.extraction
              ? { extraction: (await this.decisions.projection(req.session, row)).fields }
              : {}),
          })),
      )
      const current = await this.core.case(req.user, id)
      // Every source/business mutation increments the case revision. Do not emit
      // a workspace assembled across different immutable source snapshots.
      if (
        current.revision !== result.revision ||
        current.counterparty_revision !== result.counterparty_revision
      )
        continue
      return { ...current, ...workflows, jobs, documents }
    }
    throw new FoundationError(409, 'REVISION_CONFLICT', 'Workspace changed during read; refresh')
  }
  @Get(':id/history') getHistory(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.core.history(req.user, id, query)
  }
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: FoundationRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    if (this.mutations) return (await this.mutations.create(req.session, key, body)).body
    throw new FoundationError(503, 'CONTRACT_NOT_RELEASED', 'Case creation is blocked', {
      blockers: ['APPROVED_POLICY_SELECTION_PENDING', 'EXPOSURE_WRITE_SCHEMA_PENDING'],
    })
  }
  @Patch(':id/exposure') async exposure(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    if (this.mutations) return (await this.mutations.update(req.session, id, key, body)).body
    await this.core.case(req.user, id)
    throw new FoundationError(503, 'CONTRACT_NOT_RELEASED', 'Exposure write schema is pending')
  }
}
