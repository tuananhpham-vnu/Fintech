import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AssessmentService } from "../financial/assessment.service";
import type { FoundationRequest } from "../foundation/ports";

@Controller()
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentService) {}
  @Get("cases/:id/assessments")
  list(
    @Req() request: FoundationRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.assessments.list(request.session, id, query);
  }
  @Get("assessments/:id")
  get(@Req() request: FoundationRequest, @Param("id") id: string) {
    return this.assessments.get(request.session, id);
  }
  @Post("cases/:id/assessments")
  @HttpCode(201)
  async run(
    @Req() request: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.assessments.run(request.session, id, key, body)).body;
  }
  @Post("assessments/:id/acknowledge")
  @HttpCode(200)
  async acknowledge(
    @Req() request: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.assessments.acknowledge(request.session, id, key, body))
      .body;
  }
}
