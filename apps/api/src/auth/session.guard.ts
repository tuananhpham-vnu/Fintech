import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FoundationError } from '../foundation/errors'
import { FOUNDATION_CONFIG } from '../foundation/ports'
import type { FoundationConfig } from '../foundation/ports'
import { IS_PUBLIC_KEY } from '../guards/public.decorator'
import {
  AuthRequest,
  hasSessionCookie,
  isUnsafeMethod,
  readCookie,
  validateCsrf,
  validateOrigin,
} from './security'
import { SessionService } from './session.service'

@Injectable()
export class FoundationSessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      if (isUnsafeMethod(request.method)) validateOrigin(request, this.config)
      return true
    }
    const session = await this.sessions.resolve(readCookie(request, this.config))
    if (!session) {
      throw new FoundationError(
        401,
        hasSessionCookie(request, this.config) ? 'SESSION_EXPIRED' : 'UNAUTHORIZED',
      )
    }
    if (isUnsafeMethod(request.method)) {
      validateOrigin(request, this.config)
      validateCsrf(request, session)
    }
    request.user = session.user
    request.session = session
    return true
  }
}
