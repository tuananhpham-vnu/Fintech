import { apiPath, request } from '@/lib/api/client'
import { counterparty, page } from '@/lib/api/decoders'

// Frozen MVP write projection; read source_refs remain opaque server-issued strings.
export type CounterpartyCreateInput = {
  name: string
  country: string
  tax_id: string | null
  industry_code: string | null
  source: {
    kind: 'declaration'
    reported_by: 'organization' | 'counterparty'
    reported_reference: string
    statement: string
  }
  reason: string
}
export type CounterpartyUpdateInput = CounterpartyCreateInput & { expected_revision: number }

export function counterpartyWriteProjection(
  body: CounterpartyCreateInput,
): CounterpartyCreateInput {
  return {
    name: body.name,
    country: body.country,
    tax_id: body.tax_id,
    industry_code: body.industry_code,
    source: {
      kind: body.source.kind,
      reported_by: body.source.reported_by,
      reported_reference: body.source.reported_reference,
      statement: body.source.statement,
    },
    reason: body.reason,
  }
}

export const counterpartiesApi = {
  counterparties: (cursor = '', signal?: AbortSignal) =>
    request(
      `/counterparties?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      page(counterparty),
      { signal },
    ),
  counterparty: (id: string, signal?: AbortSignal) =>
    request(apiPath('counterparties', id), counterparty, { signal }),
  createCounterparty: (body: CounterpartyCreateInput, key: string) =>
    request('/counterparties', counterparty, {
      method: 'POST',
      body: counterpartyWriteProjection(body),
      idempotencyKey: key,
    }),
  updateCounterparty: (id: string, body: CounterpartyUpdateInput, key: string) =>
    request(apiPath('counterparties', id), counterparty, {
      method: 'PATCH',
      body: { ...counterpartyWriteProjection(body), expected_revision: body.expected_revision },
      idempotencyKey: key,
    }),
}
