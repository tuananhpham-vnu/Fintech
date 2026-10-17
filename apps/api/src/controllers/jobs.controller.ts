import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { InMemoryDbService } from '../state/in-memory-db.service'

@Controller('jobs')
export class JobsController {
  constructor(private readonly db: InMemoryDbService) {}

  @Get(':id')
  getOne(@Param('id') id: string) {
    const job = this.db.getJob(id)
    if (!job) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Job ${id} not found`,
      })
    }
    return job
  }
}
