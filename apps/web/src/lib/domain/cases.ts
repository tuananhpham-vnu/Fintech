import type { CaseDetail } from '@/lib/api/contracts'
export const rolePairs = {
  RECEIVABLE: ['seller', 'buyer'],
  PREPAYMENT: ['buyer', 'seller'],
  LOAN: ['lender', 'borrower'],
  DEBT_INVESTMENT: ['investor', 'issuer'],
} as const
export function hasRunningWork(detail: CaseDetail) {
  return (
    !!detail.jobs?.some((j) => ['queued', 'running'].includes(j.state)) ||
    ['queued', 'running'].includes(detail.assessment?.state ?? '')
  )
}
