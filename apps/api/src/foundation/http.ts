import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { FoundationError } from './errors'

@Injectable()
export class FoundationHttpMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    ;(req as any).requestId = randomUUID()
    res.setHeader('x-request-id', (req as any).requestId)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  }
}

@Catch()
export class FoundationExceptionFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp(),
      req = ctx.getRequest(),
      res = ctx.getResponse<Response>()
    const pgConflict = error?.code === '23505'
    const invalidInput = ['23503', '23514', '22P02', '22003'].includes(error?.code)
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : pgConflict
          ? 409
          : invalidInput
            ? 422
            : error?.type === 'entity.too.large'
              ? 413
              : error?.type === 'entity.parse.failed'
                ? 422
                : 500
    const raw = error instanceof HttpException ? (error.getResponse() as any) : null
    const fallback =
      status === 404
        ? 'NOT_FOUND'
        : pgConflict
          ? 'CONFLICT'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status < 500
              ? 'INVALID_INPUT'
              : 'INTERNAL_ERROR'
    const code =
      raw && typeof raw === 'object' && typeof raw.code === 'string' ? raw.code : fallback
    const publicDetails =
      status < 500 || (error instanceof FoundationError && code === 'CONTRACT_NOT_RELEASED')
    const requestId = req.requestId || randomUUID()
    res.setHeader('x-request-id', requestId)
    res
      .status(status)
      .json({
        code,
        message: publicDetails && typeof raw?.message === 'string' ? raw.message : code,
        request_id: requestId,
        details: publicDetails ? (raw?.details ?? null) : null,
      })
  }
}
