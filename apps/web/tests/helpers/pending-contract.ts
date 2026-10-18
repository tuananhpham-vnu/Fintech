import { ApiError } from '@/lib/api/client'
/** Historical unreleased-contract fixture, retained only for its negative test.
 * The live operations now have released DTOs and no longer import this helper. */
export const contractPending = (): Promise<never> =>
  Promise.reject(new ApiError(0, 'CONTRACT_NOT_RELEASED', 'AIC-B01 payload is not released'))
