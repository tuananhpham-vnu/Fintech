import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'

export interface SessionData {
  user: {
    id: string
    organization_id: string
    display_name: string
    role: 'specialist'
  }
  csrf_token: string
  expires_at: string
}

export interface DocumentItem {
  id: string
  lineage: string
  version: number
  hash: string
  pages: number
  source: string
  owner_party_ref: string
  type: string
  classification: string
  status: string
  name: string
  extraction?: any[] | null
  response_request_id?: string
}

export interface JobItem {
  id: string
  state: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  retryable?: boolean
  errors?: { code: string; message: string }[]
}

export interface EvidenceItem {
  id: string
  document_id: string
  document_version: number
  page: number
  quote: string
  source_hash: string
  bbox?: number[] | null
}

export interface CaseItem {
  id: string
  organization_id: string
  counterparty_id: string
  exposure_kind: 'RECEIVABLE' | 'PREPAYMENT' | 'LOAN' | 'DEBT_INVESTMENT'
  lifecycle_stage: 'proposed' | 'active'
  revision: number
  policy_version: string
  method_version?: string | null
  latest_review_run_id?: string | null
  latest_assessment_id?: string | null
  created_at: string
  updated_at: string
  exposure: {
    amount_vnd: string
    term_days: number | null
    organization_role: string
    counterparty_role: string
    contract_ref: string | null
    conditions: any[]
    source_origin: string
  }
  documents: DocumentItem[]
  jobs: JobItem[]
  findings: any[]
  waivers: any[]
  requests: any[]
  questionnaires: any[]
  financial_metrics: any[]
  readiness: any
  assessment: any | null
}

export interface CounterpartyItem {
  id: string
  organization_id: string
  name: string
  country: string
  tax_id: string | null
  industry_code: string | null
  source_refs: string[]
  revision: number
  identity_status: 'unresolved' | 'confirmed' | 'conflicting'
  created_at: string
  updated_at: string
}

const ORG_ID = '00000000-0000-4000-8000-000000000100'
const USER_ID = '00000000-0000-4000-8000-000000000101'
const CP_ID_1 = '00000000-0000-4000-8000-000000000001'
const CP_ID_2 = '00000000-0000-4000-8000-000000000002'
const GOLD_CASE_ID = 'a06adf0c-7110-51f6-86ad-4b4b903c3e9e'

@Injectable()
export class InMemoryDbService {
  private sessions = new Map<string, SessionData>()
  private counterparties: CounterpartyItem[] = []
  private cases: CaseItem[] = []
  private documents = new Map<string, DocumentItem>()
  private evidence = new Map<string, EvidenceItem>()
  private jobs = new Map<string, JobItem>()

  constructor() {
    this.seed()
  }

  private seed() {
    const now = new Date().toISOString()
    this.counterparties = [
      {
        id: CP_ID_1,
        organization_id: ORG_ID,
        name: 'FEASIBILITY TEST · CUSTOMER',
        country: 'VN',
        tax_id: '0100000001',
        industry_code: '46',
        source_refs: [],
        revision: 1,
        identity_status: 'confirmed',
        created_at: now,
        updated_at: now,
      },
      {
        id: CP_ID_2,
        organization_id: ORG_ID,
        name: 'FEASIBILITY TEST · SUPPLIER',
        country: 'VN',
        tax_id: '0100000002',
        industry_code: '46',
        source_refs: [],
        revision: 1,
        identity_status: 'unresolved',
        created_at: now,
        updated_at: now,
      },
    ]

    const baseReadiness = {
      case_revision: 1,
      document_review_allowed: true,
      numeric_assessment_allowed: false,
      method_status: 'unconfigured',
      blockers: [
        { code: 'METHOD_UNCONFIGURED', message: 'Method is not configured' },
      ],
      limitations: ['Integration Feasibility Prototype — In-memory test backend'],
      waivable_requirements: [
        { requirement_key: 'transaction.acceptance_record', label: 'Acceptance record' },
      ],
    }

    // Seed the gold case for testing fixtures
    const goldCase: CaseItem = {
      id: GOLD_CASE_ID,
      organization_id: ORG_ID,
      counterparty_id: CP_ID_1,
      exposure_kind: 'RECEIVABLE',
      lifecycle_stage: 'proposed',
      revision: 1,
      policy_version: 'AIC-TRANSPORT-TEST',
      created_at: now,
      updated_at: now,
      exposure: {
        amount_vnd: '500000000',
        term_days: 30,
        organization_role: 'seller',
        counterparty_role: 'buyer',
        contract_ref: 'AIC-FEASIBILITY-01',
        conditions: [],
        source_origin: 'staff_entered',
      },
      documents: [],
      jobs: [],
      findings: [],
      waivers: [],
      requests: [],
      questionnaires: [],
      financial_metrics: [],
      readiness: { ...baseReadiness },
      assessment: null,
    }

    // Seed case 2
    const case2: CaseItem = {
      id: '00000000-0000-4000-8000-000000000012',
      organization_id: ORG_ID,
      counterparty_id: CP_ID_2,
      exposure_kind: 'PREPAYMENT',
      lifecycle_stage: 'proposed',
      revision: 1,
      policy_version: 'AIC-TRANSPORT-TEST',
      created_at: now,
      updated_at: now,
      exposure: {
        amount_vnd: '200000000',
        term_days: 45,
        organization_role: 'buyer',
        counterparty_role: 'seller',
        contract_ref: 'AIC-FEASIBILITY-02',
        conditions: [],
        source_origin: 'staff_entered',
      },
      documents: [],
      jobs: [],
      findings: [],
      waivers: [],
      requests: [],
      questionnaires: [],
      financial_metrics: [],
      readiness: { ...baseReadiness },
      assessment: null,
    }

    this.cases = [goldCase, case2]
  }

  // Session management
  createSession(username: string): { sessionToken: string; session: SessionData } {
    const sessionToken = crypto.randomUUID()
    const session: SessionData = {
      user: {
        id: USER_ID,
        organization_id: ORG_ID,
        display_name: `Chuyên viên (${username})`,
        role: 'specialist',
      },
      csrf_token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }
    this.sessions.set(sessionToken, session)
    return { sessionToken, session }
  }

  getSession(token?: string): SessionData | null {
    if (!token) return null
    const s = this.sessions.get(token)
    if (!s) return null
    if (Date.parse(s.expires_at) <= Date.now()) {
      this.sessions.delete(token)
      return null
    }
    return s
  }

  removeSession(token?: string): void {
    if (token) this.sessions.delete(token)
  }

  // Counterparties
  getCounterparties(): CounterpartyItem[] {
    return this.counterparties
  }

  getCounterparty(id: string): CounterpartyItem | null {
    return this.counterparties.find((c) => c.id === id) || null
  }

  // Cases
  getCases(): CaseItem[] {
    return this.cases
  }

  getCase(id: string): CaseItem | null {
    return this.cases.find((c) => c.id === id) || null
  }

  bumpCaseRevision(c: CaseItem): number {
    c.revision++
    c.updated_at = new Date().toISOString()
    c.readiness.case_revision = c.revision
    return c.revision
  }

  // Documents
  addDocument(c: CaseItem, doc: DocumentItem): void {
    c.documents.unshift(doc)
    this.documents.set(doc.id, doc)
  }

  getDocument(id: string): DocumentItem | null {
    return this.documents.get(id) || null
  }

  // Jobs
  addJob(c: CaseItem, job: JobItem): void {
    c.jobs.unshift(job)
    this.jobs.set(job.id, job)
  }

  getJob(id: string): JobItem | null {
    return this.jobs.get(id) || null
  }

  // Evidence
  addEvidence(ev: EvidenceItem): void {
    this.evidence.set(ev.id, ev)
  }

  getEvidence(id: string): EvidenceItem | null {
    return this.evidence.get(id) || null
  }

  // Idempotency Tracking
  private readonly idempotencyStore = new Map<
    string,
    { caseId: string; sha256: string; response: any }
  >()

  getIdempotency(key: string) {
    return this.idempotencyStore.get(key) || null
  }

  setIdempotency(key: string, caseId: string, sha256: string, response: any): void {
    this.idempotencyStore.set(key, { caseId, sha256, response })
  }
}
