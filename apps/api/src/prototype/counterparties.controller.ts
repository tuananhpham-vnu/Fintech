import { Controller, Get, Param, NotFoundException } from '@nestjs/common'
import { InMemoryDbService } from '../state/in-memory-db.service'

@Controller('counterparties')
export class CounterpartiesController {
  constructor(private readonly db: InMemoryDbService) {}

  @Get()
  list() {
    return {
      items: this.db.getCounterparties(),
      next_cursor: null,
    }
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const cp = this.db.getCounterparty(id)
    if (!cp) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Counterparty ${id} not found`,
      })
    }
    return cp
  }
}
