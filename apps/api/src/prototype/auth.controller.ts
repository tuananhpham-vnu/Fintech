import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { InMemoryDbService } from '../state/in-memory-db.service'
import { Public } from '../guards/public.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly db: InMemoryDbService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { username, password } = body || {}
    if (!username || !password) {
      throw new BadRequestException({
        code: 'INVALID_CREDENTIALS',
        message: 'Username and password are required',
      })
    }

    // In feasibility prototype, allow any non-empty password, or standard test credentials
    const { sessionToken, session } = this.db.createSession(username)

    // Issue HttpOnly session cookie
    res.cookie('aic_fe_qa', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 3600 * 1000,
    })

    return session
  }

  @Get('me')
  async me(@Req() req: Request) {
    const rawCookie = req.headers.cookie || ''
    const cookieToken = rawCookie.match(/(?:^|;\s*)aic_fe_qa=([^;]+)/)?.[1]
    const token = req.cookies?.['aic_fe_qa'] || cookieToken
    const session = this.db.getSession(token)
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        message: 'Session is expired or invalid',
      })
    }
    return session
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.['aic_fe_qa']
    this.db.removeSession(token)
    res.clearCookie('aic_fe_qa', { path: '/' })
  }
}
