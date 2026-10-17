import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { CookieOptions, Response } from 'express'
import { FoundationError } from '../foundation/errors'
import { FOUNDATION_CONFIG } from '../foundation/ports'
import type { FoundationConfig, SessionOutput } from '../foundation/ports'
import { Public } from '../guards/public.decorator'
import {
  AuthRequest,
  readCookie,
  sessionOutput,
  validateCsrf,
  validateLogin,
  validateOrigin,
} from './security'
import { SessionService } from './session.service'

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionOutput> {
    const { username, password } = validateLogin(body)
    // Socket peer only: Express req.ip may depend on trust proxy / forwarded headers.
    const peerAddress = request.socket.remoteAddress ?? 'unknown-peer'
    const result = await this.sessions.login(username, password, peerAddress)
    response.setHeader('Cache-Control', 'no-store')
    response.cookie(this.config.cookieName, result.token, {
      ...this.cookieOptions(),
      maxAge: this.config.sessionTtlMs,
    })
    return result.session
  }

  @Get('me')
  me(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response): SessionOutput {
    if (!request.session) throw new FoundationError(401, 'UNAUTHORIZED')
    response.setHeader('Cache-Control', 'no-store')
    return sessionOutput(request.session)
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    validateOrigin(request, this.config)
    const token = readCookie(request, this.config)
    const session = await this.sessions.resolve(token)
    if (session) validateCsrf(request, session)
    await this.sessions.revoke(token)
    response.setHeader('Cache-Control', 'no-store')
    response.clearCookie(this.config.cookieName, this.cookieOptions())
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.config.isProduction || this.config.secureCookies,
    }
  }
}
