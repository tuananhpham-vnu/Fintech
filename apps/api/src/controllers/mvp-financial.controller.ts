import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Query,
} from '@nestjs/common'
import { FinancialRegistry } from '../financial/financial-registry.service'
import type { FoundationRequest } from '../foundation/ports'
@Controller()
export class MvpFinancialController {
  constructor(private readonly finance: FinancialRegistry) {}
  @Get('cases/:id/financial-sets') get(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Query('set_id') setId?: string,
  ) {
    return this.finance.get(r.session, id, setId)
  }
  @Post('cases/:id/financial-sets') @HttpCode(201) async create(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.finance.save(r.session, id, undefined, key, body)).body
  }
  @Patch('financial-sets/:id') async revise(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.finance.revise(r.session, id, key, body)).body
  }
  @Post('financial-sets/:id/verification') @HttpCode(200) async verify(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.finance.verify(r.session, id, key, body)).body
  }
}
