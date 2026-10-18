import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { InMemoryDbService } from '../state/in-memory-db.service'

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly db: InMemoryDbService) {}

  @Get(':id')
  getOne(@Param('id') id: string) {
    const ev = this.db.getEvidence(id)
    if (!ev) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Evidence ${id} not found`,
      })
    }
    return ev
  }
}
