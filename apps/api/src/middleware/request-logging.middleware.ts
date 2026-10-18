import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import * as crypto from 'crypto'

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP')

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now()
    const requestId =
      (req.headers['x-request-id'] as string) || crypto.randomUUID()

    // Propagate x-request-id on response header for request correlation
    res.setHeader('x-request-id', requestId)

    res.on('finish', () => {
      const duration = Date.now() - start
      const url = req.originalUrl || req.url
      this.logger.log(`[REQ] ${requestId} ${req.method} ${url} - ${duration}ms`)
    })

    next()
  }
}
