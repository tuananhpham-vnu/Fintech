import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { FoundationRequest } from "../foundation/ports";
import { FoundationError } from "../foundation/errors";
import { DossierUploadGuard } from "../documents/dossiers.controller";
import {
  FinancialIntakeService,
  INTAKE_MAX_BYTES,
} from "../financial/financial-intake.service";
import { FinancialReviewService } from "../financial/financial-review.service";

@Controller()
export class FinancialIntakeController {
  constructor(
    private intake: FinancialIntakeService,
    private review: FinancialReviewService,
  ) {}
  @Get("cases/:id/financial-intakes")
  list(@Req() r: FoundationRequest, @Param("id") id: string) {
    return this.intake.list(r.session, id);
  }
  @Post("cases/:id/financial-intakes")
  @HttpCode(202)
  @UseGuards(DossierUploadGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: INTAKE_MAX_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 1024,
      },
    }),
  )
  async upload(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    if (
      !body ||
      Object.keys(body).some((k) => k !== "expected_revision") ||
      typeof body.expected_revision !== "string" ||
      !/^[1-9][0-9]*$/.test(body.expected_revision) ||
      !Number.isSafeInteger(Number(body.expected_revision))
    )
      throw new FoundationError(422, "INVALID_INPUT");
    return (
      await this.intake.upload(
        r.session,
        id,
        key,
        file,
        Number(body.expected_revision),
      )
    ).body;
  }
  @Post("cases/:id/financial-intakes/existing")
  @HttpCode(202)
  async existing(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.intake.importExisting(r.session, id, key, body)).body;
  }
  @Post("cases/:id/financial-intakes/:job/decision")
  async decide(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Param("job") job: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.intake.decide(r.session, id, job, key, body)).body;
  }
  @Post("cases/:id/financial-review-confirmations")
  @HttpCode(201)
  async confirm(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return (await this.review.confirm(r.session, id, key, body)).body;
  }
  @Get("financial-intakes/:id/original")
  async original(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await this.intake.original(r.session, id);
    res.setHeader("Content-Type", file.content_type);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="source${file.name.match(/\.[a-z0-9]+$/i)?.[0] || ".bin"}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader("X-Source-SHA256", file.sha256);
    res.setHeader("Content-Length", file.bytes.length);
    res.send(file.bytes);
  }
}
