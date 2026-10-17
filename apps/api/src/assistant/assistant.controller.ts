import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import type { FoundationRequest } from '../foundation/ports'
import { AssistantService } from './assistant.service'

@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Post('cases/:id/assistant/messages') @HttpCode(200) ask(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.assistant.ask(r.session, id, body)
  }
  @Get('cases/:id/assistant/search') search(
    @Req() r: FoundationRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.assistant.search(r.session, id, query)
  }
}
