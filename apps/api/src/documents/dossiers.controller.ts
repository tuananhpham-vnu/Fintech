import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { FoundationError } from '../foundation/errors'
import { CoreRepository } from '../foundation/core.repository'
import type { FoundationRequest } from '../foundation/ports'
import { DOSSIER_MAX_BYTES, DossierRepository } from './dossier.repository'

/** Reserve before Multer allocates ZIP bytes, release on every response/error. */
@Injectable()
export class DossierUploadGuard implements CanActivate {
  private static active = 0
  canActivate(context: ExecutionContext) {
    if (DossierUploadGuard.active >= 2) throw new FoundationError(503, 'DOSSIER_UPLOAD_BUSY')
    DossierUploadGuard.active++
    let released = false
    const release = () => { if (!released) { released = true; DossierUploadGuard.active-- } }
    const response = context.switchToHttp().getResponse<Response>()
    response.once('finish', release)
    response.once('close', release)
    return true
  }
}

@Controller()
export class DossiersController {
  constructor(private readonly repository: DossierRepository, private readonly core: CoreRepository) {}
  @Post('cases/:id/dossier-archives')
  @HttpCode(202)
  @UseGuards(DossierUploadGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOSSIER_MAX_BYTES, files: 1, fields: 1, fieldSize: 1024 } }))
  async upload(@Req() req: FoundationRequest & { headers: Record<string, unknown> }, @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File, @Body() body: Record<string, unknown>) {
    await this.core.case(req.user, id)
    if (!body || Object.keys(body).some((k) => k !== 'expected_revision') || typeof body.expected_revision !== 'string' ||
        !/^[1-9][0-9]*$/.test(body.expected_revision) || !Number.isSafeInteger(Number(body.expected_revision)))
      throw new FoundationError(422, 'INVALID_INPUT')
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new FoundationError(422, 'INVALID_IDEMPOTENCY_KEY')
    if (!file?.buffer || !/\.zip$/i.test(file.originalname) ||
        !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype))
      throw new FoundationError(422, 'ARCHIVE_INVALID_ZIP')
    return this.repository.enqueue(req.session, id, key, file.buffer, Number(body.expected_revision))
  }
  @Get('cases/:id/dossier-archives')
  list(@Req() req: FoundationRequest, @Param('id') id: string) { return this.repository.list(req.session, id) }
  @Get('dossier-archives/:id')
  get(@Req() req: FoundationRequest, @Param('id') id: string) { return this.repository.get(req.session, id) }
  @Get('dossier-members/:id/extraction-summary')
  summary(@Req() req: FoundationRequest, @Param('id') id: string) { return this.repository.memberSummary(req.session, id) }
  @Get('dossier-members/:id/source')
  async source(@Req() req: FoundationRequest, @Param('id') id: string, @Res() res: Response) {
    const result = await this.repository.source(req.session, id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"')
    res.setHeader('Content-Length', result.bytes.length)
    res.setHeader('X-Source-SHA256', result.member.sha256)
    res.send(result.bytes)
  }
}
