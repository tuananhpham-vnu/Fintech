import { HttpException } from '@nestjs/common'

export class FoundationError extends HttpException {
  constructor(
    status: number,
    code: string,
    message = code,
    details: Record<string, unknown> | null = null,
  ) {
    super({ code, message, details }, status)
  }
}
export const notFound = () => new FoundationError(404, 'NOT_FOUND')
