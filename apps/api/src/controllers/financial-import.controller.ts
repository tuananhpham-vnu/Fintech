import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import type { FoundationRequest } from '../foundation/ports'
import { FoundationError } from '../foundation/errors'
import { FinancialImportService } from '../financial/financial-import.service'
import { DossierUploadGuard } from '../documents/dossiers.controller'

@Controller()
export class FinancialImportController {
  constructor(private readonly imports: FinancialImportService) {}
  @Get('cases/:id/financial-import-sources')
  list(@Req() r: FoundationRequest,@Param('id') id:string) { return this.imports.list(r.session,id) }
  @Post('cases/:id/financial-imports') @HttpCode(201)
  run(@Req() r: FoundationRequest,@Param('id') id:string,@Headers('idempotency-key') key:string,@Body() body:unknown) {
    return this.imports.run(r.session,id,key,body)
  }
  @Get('cases/:id/financial-imports/:receipt')
  receipt(@Req() r: FoundationRequest,@Param('id') id:string,@Param('receipt') receipt:string) {
    return this.imports.receipt(r.session,id,receipt)
  }
  @Post('cases/:id/financial-files') @HttpCode(201)
  @UseGuards(DossierUploadGuard)
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:25_000_000,files:1,fields:1,fieldSize:1024}}))
  async upload(@Req() r:FoundationRequest,@Param('id') id:string,@Headers('idempotency-key') key:string,
    @UploadedFile() file:Express.Multer.File,@Body() body:Record<string,unknown>) {
    if (!body || Object.keys(body).some(k=>k!=='expected_revision') || typeof body.expected_revision!=='string' ||
      !/^[1-9][0-9]*$/.test(body.expected_revision)) throw new FoundationError(422,'INVALID_INPUT')
    return (await this.imports.upload(r.session,id,key,file,Number(body.expected_revision))).body
  }
  @Get('financial-files/:id/source')
  async source(@Req() r:FoundationRequest,@Param('id') id:string,@Res() res:Response) {
    const file = await this.imports.file(r.session,id)
    res.setHeader('Content-Type','application/pdf')
    res.setHeader('Content-Disposition','inline; filename="financial.pdf"')
    res.setHeader('Content-Length',file.bytes.length)
    res.setHeader('X-Source-SHA256',file.sha256)
    res.send(file.bytes)
  }
}
