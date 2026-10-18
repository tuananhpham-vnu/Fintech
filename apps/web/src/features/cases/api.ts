import { apiPath, request, unknownResponse } from '@/lib/api/client'
import type { CaseCreate, Exposure, RevisionInput } from '@/lib/api/contracts'
import { caseRecord, detail, page } from '@/lib/api/decoders'
export const casesApi = {
  companyCapabilities: (signal?: AbortSignal) =>
    request(
      '/company-assessments/capabilities',
      (v) => {
        if (
          !v ||
          typeof v !== 'object' ||
          !('schema_version' in v) ||
          v.schema_version !== 'AIC-COMPANY-HEALTH-1' ||
          !('available' in v) ||
          typeof v.available !== 'boolean'
        )
          throw new Error('INVALID_API_RESPONSE')
        return { available: v.available }
      },
      { signal },
    ),
  createCompany: (
    body: { schema_version: 'AIC-COMPANY-HEALTH-1'; counterparty_id: string; reason: string },
    key: string,
  ) => request('/company-assessments', caseRecord, { method: 'POST', body, idempotencyKey: key }),
  cases: (cursor = '', signal?: AbortSignal) =>
    request(
      `/cases?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      page(caseRecord),
      { signal },
    ),
  createCase: (body: CaseCreate, key: string) =>
    request('/cases', caseRecord, { method: 'POST', body, idempotencyKey: key }),
  detail: (id: string, signal?: AbortSignal) => request(apiPath('cases', id), detail, { signal }),
  exposure: (id: string, body: RevisionInput & { exposure: Exposure }, key: string) =>
    request(apiPath('cases', id, '/exposure'), unknownResponse, {
      method: 'PATCH',
      body,
      idempotencyKey: key,
    }),
}
