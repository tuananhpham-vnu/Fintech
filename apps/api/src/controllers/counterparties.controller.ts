import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Post,
  Patch,
  Optional,
  Body,
  Headers,
  HttpCode,
} from '@nestjs/common'
import { CoreRepository } from '../foundation/core.repository'
import { FoundationRequest } from '../foundation/ports'
import { FoundationError } from '../foundation/errors'
import { MvpCounterpartyService } from '../foundation/mvp-counterparty.service'

@Controller('counterparties')
export class CounterpartiesController {
  constructor(
    private readonly core: CoreRepository,
    @Optional() private readonly mutations?: MvpCounterpartyService,
  ) {}
  @Get() list(@Req() req: FoundationRequest, @Query() query: unknown) {
    return this.core.counterparties(req.user, query)
  }
  @Get(':id') getOne(@Req() req: FoundationRequest, @Param('id') id: string) {
    return this.core.counterparty(req.user, id)
  }
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: FoundationRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    if (this.mutations) return (await this.mutations.create(req.session, key, body)).body
    throw new FoundationError(
      503,
      'CONTRACT_NOT_RELEASED',
      'Counterparty writes require the local MVP runtime',
    )
  }
  @Patch(':id') async update(
    @Req() req: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    if (this.mutations) return (await this.mutations.update(req.session, id, key, body)).body
    await this.core.counterparty(req.user, id)
    throw new FoundationError(
      503,
      'CONTRACT_NOT_RELEASED',
      'Counterparty writes require the local MVP runtime',
    )
  }
}
