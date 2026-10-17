import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../guards/public.decorator'
import { MvpCapabilityService } from '../foundation/mvp-capability.service'
import type { FoundationRequest } from '../foundation/ports'

@Controller()
export class MvpCapabilitiesController {
  constructor(private readonly capabilities: MvpCapabilityService) {}
  @Post('questionnaires/:id/invitations')
  @HttpCode(201)
  async create(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.capabilities.create(r.session, id, key, body)
    if (result.rawToken) res.setHeader('X-Invitation-Token', result.rawToken)
    return result.body
  }
  @Post('invitations/:id/revoke')
  @HttpCode(200)
  async revoke(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.capabilities.revoke(r.session, id, key, body)).body
  }
  @Post('questionnaires/:id/close')
  @HttpCode(200)
  async close(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.capabilities.close(r.session, id, key, body)).body
  }
  private token(value: string) {
    return typeof value === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/.test(value)
      ? value.slice(7)
      : ''
  }
  @Public()
  @Get('respondent/form')
  form(@Req() r: Request, @Headers('authorization') token: string) {
    return this.capabilities.form(this.token(token), r.socket.remoteAddress ?? 'unavailable')
  }
  @Public()
  @Post('respondent/responses')
  @HttpCode(201)
  submit(
    @Req() r: Request,
    @Headers('authorization') token: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.capabilities.submit(
      this.token(token),
      r.socket.remoteAddress ?? 'unavailable',
      key,
      body,
    )
  }
}
