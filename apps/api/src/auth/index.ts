export { AuthController } from './auth.controller'
export { SessionService } from './session.service'
export type { LoginResult } from './session.service'
export { FoundationSessionGuard } from './session.guard'
export { hashPassword, verifyPassword, MAX_PASSWORD_BYTES, MAX_PASSWORD_LENGTH } from './password'
export {
  readCookie,
  hasSessionCookie,
  validateOrigin,
  validateCsrf,
  validateLogin,
  isUnsafeMethod,
  isSessionToken,
  hashToken,
  deriveCsrfToken,
  loginBucketHash,
  sessionOutput,
  MAX_USERNAME_BYTES,
  MAX_USERNAME_LENGTH,
  MAX_COOKIE_HEADER_BYTES,
} from './security'
export type { AuthRequest } from './security'
