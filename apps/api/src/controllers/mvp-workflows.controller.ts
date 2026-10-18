import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { FoundationRequest } from "../foundation/ports";
import { MvpWorkflowService } from "../foundation/mvp-workflow.service";
import { AssessmentService } from "../financial/assessment.service";

/** Registered only in explicit local document runtime. Global session/CSRF applies. */
@Controller()
export class MvpWorkflowsController {
  constructor(
    private readonly workflows: MvpWorkflowService,
    private readonly assessments: AssessmentService,
  ) {}
  @Get("cases/:id/readiness")
  async readiness(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Query("set_id") setId?: string,
  ) {
    return (await this.assessments.workspace(r.session, id, setId)).readiness;
  }
  @Post("cases/:id/review-runs")
  @HttpCode(201)
  async run(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.run(r.session, id, key, b)).body;
  }
  @Get("review-runs/:id") getRun(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
  ) {
    return this.workflows.getRun(r.session, id);
  }
  @Post("issues/:id/decisions")
  @HttpCode(200)
  async decideIssue(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.decideIssue(r.session, id, key, b)).body;
  }
  @Post("cases/:id/requests")
  @HttpCode(201)
  async draft(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.draft(r.session, id, key, b)).body;
  }
  @Patch("requests/:id")
  async edit(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.editDraft(r.session, id, key, b)).body;
  }
  @Post("requests/:id/approve")
  @HttpCode(200)
  async approve(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (
      await this.workflows.decideRequest(r.session, id, "approve", key, b)
    ).body;
  }
  @Post("requests/:id/cancel")
  @HttpCode(200)
  async cancel(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.decideRequest(r.session, id, "cancel", key, b))
      .body;
  }
  @Post("requests/:id/ack")
  @HttpCode(200)
  async ack(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.decideRequest(r.session, id, "ack", key, b))
      .body;
  }
  @Get("requests/:id/export")
  async exportRequest(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const result = await this.workflows.exportRequest(r.session, id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="supplement-request.txt"',
    );
    res.setHeader("X-Export-SHA256", result.hash);
    res.send(result.bytes);
  }
  @Post("cases/:id/waivers")
  @HttpCode(201)
  async waive(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.waive(r.session, id, key, b)).body;
  }
  @Post("waivers/:id/revoke")
  @HttpCode(200)
  async revoke(
    @Req() r: FoundationRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return (await this.workflows.revoke(r.session, id, key, b)).body;
  }
}
