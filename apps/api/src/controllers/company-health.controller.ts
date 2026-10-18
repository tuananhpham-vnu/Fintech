import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import { MvpCaseService } from "../foundation/mvp-case.service";
import type { FoundationRequest } from "../foundation/ports";
import { validateContract } from "../foundation/validation";

@Controller("company-assessments")
export class CompanyHealthController {
  constructor(private readonly cases: MvpCaseService) {}
  @Get("capabilities")
  async capabilities(@Req() req: FoundationRequest) {
    return validateContract(
      "CompanyHealthCapabilitiesV1",
      await this.cases.companyCapabilities(req.session),
      true,
    );
  }
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: FoundationRequest,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.cases.createCompany(req.session, key, body)).body;
  }
}
