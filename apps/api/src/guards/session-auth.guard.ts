import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { InMemoryDbService } from '../state/in-memory-db.service'
import { IS_PUBLIC_KEY } from './public.decorator'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: InMemoryDbService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const req = context.switchToHttp().getRequest<Request>()
    const rawCookie = req.headers.cookie || ''
    const cookieToken = rawCookie.match(/(?:^|;\s*)aic_fe_qa=([^;]+)/)?.[1]
    const token = req.cookies?.['aic_fe_qa'] || cookieToken

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Missing session cookie.',
      })
    }

    const session = this.db.getSession(token)
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        message: 'Session is expired or invalid.',
      })
    }

    ;(req as any).user = session.user
    ;(req as any).session = session
    return true
  }
}
