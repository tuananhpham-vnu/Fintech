import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Public } from "../guards/public.decorator";
import { FOUNDATION_DB } from "../foundation/ports";
import type { FoundationDatabase } from "../foundation/ports";

/** Private ingress probes; response never exposes configuration, identities or database errors. */
@Controller("health")
export class HealthController {
  constructor(@Inject(FOUNDATION_DB) private readonly db: FoundationDatabase) {}
  @Public()
  @Get("live")
  live() {
    return { status: "alive" };
  }
  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.db.query("SELECT 1");
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException("Service not ready");
    }
  }
}
