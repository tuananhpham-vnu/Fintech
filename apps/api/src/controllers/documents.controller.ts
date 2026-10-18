import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import type { Response } from 'express'
import { InMemoryDbService } from '../state/in-memory-db.service'
import { StorageService } from '../storage/storage.service'

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly db: InMemoryDbService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id/source')
  getSource(@Param('id') id: string, @Res() res: Response) {
    this.storage.validateDocId(id)
    const doc = this.db.getDocument(id)
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Document ${id} not found`,
      })
    }
    const bytes = this.storage.getFile(id)
    if (!bytes) {
      throw new NotFoundException({
        code: 'PDF_NOT_FOUND',
        message: `PDF content for document ${id} not found on disk`,
      })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="${doc.name}"`)
    res.send(bytes)
  }

  @Get(':id/extraction')
  getExtraction(@Param('id') id: string) {
    this.storage.validateDocId(id)
    const doc = this.db.getDocument(id)
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Document ${id} not found`,
      })
    }

    if (doc.extraction === null || doc.extraction === undefined) {
      throw new ConflictException({
        code: 'EXTRACTION_NOT_READY',
        message: 'Extraction has not completed or is not available',
      })
    }

    return doc.extraction
  }
}
