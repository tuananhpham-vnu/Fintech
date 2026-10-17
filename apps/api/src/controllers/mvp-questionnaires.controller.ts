import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common'
import { MvpQuestionnaireService } from '../foundation/mvp-questionnaire.service'
import type { FoundationRequest } from '../foundation/ports'

/** Local runtime only; global session, Origin and CSRF guards apply. */
@Controller()
export class MvpQuestionnairesController {
  constructor(private readonly questionnaires: MvpQuestionnaireService) {}
  @Post('cases/:id/questionnaires')
  @HttpCode(201)
  async create(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.questionnaires.create(r.session, id, key, body)).body
  }
  @Get('questionnaires/:id')
  get(@Req() r: FoundationRequest, @Param('id') id: string) {
    return this.questionnaires.get(r.session, id)
  }
  @Post('questionnaires/:id/staff-responses')
  @HttpCode(201)
  async respond(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.questionnaires.respond(r.session, id, key, body)).body
  }
  @Post('responses/:id/verification')
  @HttpCode(201)
  async verify(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return (await this.questionnaires.verify(r.session, id, key, body)).body
  }
}
