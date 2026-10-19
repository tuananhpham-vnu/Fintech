import { rolePairs } from '@/lib/domain/cases'
import { decodeAccountingProfile, isFullFiscalYear } from './accounting-profile'
import {
  type Assessment,
  type CaseAggregation,
  type PartialAssessment,
  type Case,
  type CaseDetail,
  type Counterparty,
  type Evidence,
  type HistoryEvent,
  type Job,
  type Page,
  type Readiness,
  type ReviewRun,
  type Session,
  type DossierAccepted,
  type DossierCounters,
  type DossierArchiveSummary,
  type DossierArchive,
  type DossierArchiveList,
  type DossierMember,
  type DossierMemberSummary,
  type ExtractionSummary,
} from './contracts'
type Obj = Record<string, unknown>
function object(value: unknown): value is Obj {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function fail(): never {
  throw new Error('INVALID_API_RESPONSE')
}
function exactKeys(value: Obj, required: string[], optional: string[] = []) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail()
}
function dateTime(value: unknown) {
  if (typeof value !== 'string') fail()
  const parts =
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value)
  if (
    !parts ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    fail()
  const calendarDate = new Date(parts[1] + 'T00:00:00Z')
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== parts[1]
  )
    fail()
}
function strings(v: Obj, keys: string[]) {
  if (!keys.every((k) => typeof v[k] === 'string')) fail()
}
function revision(v: Obj, key = 'revision') {
  if (!Number.isSafeInteger(v[key]) || Number(v[key]) < 1) fail()
}
function list(v: Obj, keys: string[]) {
  if (!keys.every((k) => Array.isArray(v[k]))) fail()
}
function stringList(v: Obj, keys: string[]) {
  list(v, keys)
  for (const k of keys) if (!(v[k] as unknown[]).every((x) => typeof x === 'string')) fail()
}
function finding(value: unknown) {
  if (!object(value)) fail()
  strings(value, ['id', 'issue_key', 'rule_id', 'category', 'severity', 'summary'])
  stringList(value, ['evidence_refs', 'limitations'])
  if (
    !['open', 'verified_resolved', 'dismissed'].includes(String(value.finding_state)) ||
    !['none', 'requested', 'waived'].includes(String(value.handling_state))
  )
    fail()
}
function extracted(value: unknown) {
  if (!object(value) || !('value' in value)) fail()
  strings(value, ['field_key', 'quality'])
  stringList(value, ['evidence_refs'])
}
function nullableNumber(value: unknown) {
  if (
    value != null &&
    !(
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))
    )
  )
    fail()
}
export function extraction(value: unknown) {
  if (!Array.isArray(value)) fail()
  value.forEach(extracted)
  return value as import('./contracts').ExtractedField[]
}
export function scopedForm(value: unknown) {
  if (!object(value)) fail()
  list(value, ['questions'])
  for (const q of value.questions as unknown[]) {
    if (!object(q)) fail()
    strings(q, ['id', 'answer_type', 'requiredness'])
    revision(q, 'version')
    if (typeof q.allowed_to_skip !== 'boolean') fail()
  }
  return value as { questions: import('./contracts').Question[]; expires_at?: string }
}
export function session(value: unknown): Session {
  if (!object(value) || !object(value.user)) fail()
  strings(value, ['csrf_token', 'expires_at'])
  strings(value.user, ['id', 'organization_id', 'display_name'])
  if (
    value.user.role !== 'specialist' ||
    !value.csrf_token ||
    !Number.isFinite(Date.parse(String(value.expires_at))) ||
    Date.parse(String(value.expires_at)) <= Date.now()
  )
    fail()
  return value as Session
}
export function counterparty(value: unknown): Counterparty {
  if (!object(value)) fail()
  strings(value, [
    'id',
    'organization_id',
    'name',
    'country',
    'identity_status',
    'created_at',
    'updated_at',
  ])
  revision(value)
  if (
    !['unresolved', 'confirmed', 'conflicting'].includes(String(value.identity_status)) ||
    !String(value.country).trim()
  )
    fail()
  return value as Counterparty
}
export function caseRecord(value: unknown): Case {
  if (!object(value)) fail()
  if (value.purpose === 'company_health') {
    strings(value, ['id', 'organization_id', 'counterparty_id', 'created_at', 'updated_at'])
    revision(value)
    for (const key of [
      'exposure_kind',
      'lifecycle_stage',
      'exposure',
      'policy_version',
      'policy_artifact_hash',
    ])
      if (value[key] !== null) fail()
    return value as Case
  }
  if (value.purpose !== undefined && value.purpose !== 'transaction') fail()
  if (!object(value.exposure)) fail()
  strings(value, [
    'id',
    'organization_id',
    'counterparty_id',
    'policy_version',
    'created_at',
    'updated_at',
  ])
  revision(value)
  if (
    !['RECEIVABLE', 'PREPAYMENT', 'LOAN', 'DEBT_INVESTMENT'].includes(
      String(value.exposure_kind),
    ) ||
    !['proposed', 'active'].includes(String(value.lifecycle_stage))
  )
    fail()
  strings(value.exposure, ['organization_role', 'counterparty_role', 'source_origin'])
  if (
    (value.exposure.amount_vnd === null
      ? typeof value.exposure.amount_missing_reason !== 'string' ||
        !value.exposure.amount_missing_reason.trim()
      : typeof value.exposure.amount_vnd !== 'string' ||
        !/^[1-9]\d{0,23}$/.test(value.exposure.amount_vnd)) ||
    !Array.isArray(value.exposure.conditions)
  )
    fail()
  const pair = rolePairs[value.exposure_kind as keyof typeof rolePairs]
  if (value.exposure.organization_role !== pair[0] || value.exposure.counterparty_role !== pair[1])
    fail()
  if (
    value.exposure.term_days !== null &&
    (!Number.isSafeInteger(value.exposure.term_days) || Number(value.exposure.term_days) < 0)
  )
    fail()
  return value as Case
}
export function page<T>(decode: (v: unknown) => T) {
  return (value: unknown): Page<T> => {
    if (
      !object(value) ||
      !Array.isArray(value.items) ||
      (value.next_cursor != null && typeof value.next_cursor !== 'string')
    )
      fail()
    return {
      items: value.items.map(decode),
      next_cursor: value.next_cursor as string | null | undefined,
    }
  }
}
export function readiness(value: unknown): Readiness {
  if (!object(value)) fail()
  if (value.assessment_allowed !== undefined && typeof value.assessment_allowed !== 'boolean')
    fail()
  revision(value, 'case_revision')
  list(value, ['blockers', 'waivable_requirements'])
  stringList(value, ['limitations'])
  if (
    typeof value.document_review_allowed !== 'boolean' ||
    typeof value.numeric_assessment_allowed !== 'boolean' ||
    ![
      'unconfigured',
      'configured_pilot',
      'validation_pending',
      'validated_for_limited_use',
      'retired',
    ].includes(String(value.method_status))
  )
    fail()
  for (const b of value.blockers as unknown[]) {
    if (!object(b)) fail()
    strings(b, ['code', 'message'])
  }
  for (const r of value.waivable_requirements as unknown[]) {
    if (!object(r)) fail()
    strings(r, ['requirement_key'])
  }
  return value as Readiness
}
export function partialAssessment(value: unknown): PartialAssessment {
  if (!object(value)) fail()
  exactKeys(value, [
    'kind',
    'available_points',
    'available_max_points',
    'unresolved_max_points',
    'lower_bound',
    'upper_bound',
    'total_metric_count',
    'components',
    'unresolved_metric_ids',
  ])
  if (value.kind !== 'data_limited_bounds' || value.total_metric_count !== 7) fail()
  for (const key of [
    'available_points',
    'available_max_points',
    'unresolved_max_points',
    'lower_bound',
    'upper_bound',
  ]) {
    const number = value[key]
    if (
      typeof number !== 'string' ||
      !/^\d{1,3}(\.\d{1,12})?$/.test(number) ||
      Number(number) > 100
    )
      fail()
  }
  list(value, ['components'])
  stringList(value, ['unresolved_metric_ids'])
  const maxById: Record<string, string> = {
    'AIC-M01': '15',
    'AIC-M02': '10',
    'AIC-M03': '20',
    'AIC-M04': '10',
    'AIC-M05': '15',
    'AIC-M06': '10',
    'AIC-M07': '20',
  }
  const components = value.components as Obj[],
    unresolved = value.unresolved_metric_ids as string[]
  if (
    !components.length ||
    components.length > 6 ||
    !unresolved.length ||
    components.length + unresolved.length !== 7
  )
    fail()
  const ids: string[] = []
  let covered = 0
  for (const part of components) {
    if (!object(part)) fail()
    exactKeys(part, ['metric_id', 'points', 'max_points'])
    strings(part, ['metric_id', 'points', 'max_points'])
    const id = part.metric_id as string,
      max = maxById[id]
    if (
      !max ||
      part.max_points !== max ||
      !/^\d{1,3}(\.\d{1,12})?$/.test(part.points as string) ||
      Number(part.points) > Number(max)
    )
      fail()
    ids.push(id)
    covered += Number(max)
  }
  if (
    unresolved.some((id) => !Object.hasOwn(maxById, id)) ||
    new Set([...ids, ...unresolved]).size !== 7 ||
    value.available_max_points !== String(covered) ||
    value.unresolved_max_points !== String(100 - covered) ||
    Number(value.available_points) > covered ||
    Number(value.lower_bound) > Number(value.available_points) ||
    Number(value.upper_bound) < Number(value.available_points) ||
    Number(value.lower_bound) > Number(value.upper_bound)
  )
    fail()
  return value as PartialAssessment
}

export function caseAggregation(value: unknown): CaseAggregation {
  if (!object(value)) fail()
  exactKeys(
    value,
    ['method', 'included_set_ids', 'excluded_sets', 'metrics'],
    ['accounting_profile'],
  )
  const profile =
    value.accounting_profile === undefined
      ? null
      : decodeAccountingProfile(value.accounting_profile)
  if (value.method !== 'mean_metric_points_v1') fail()
  stringList(value, ['included_set_ids'])
  list(value, ['excluded_sets', 'metrics'])
  const included = value.included_set_ids as string[],
    metrics = value.metrics as Obj[]
  if (new Set(included).size !== included.length || metrics.length !== 7) fail()
  const metricIds = new Set<string>(),
    used = new Set<string>(),
    excluded = new Set<string>()
  const maxima: Record<string, number> = {
    'AIC-M01': 15,
    'AIC-M02': 10,
    'AIC-M03': 20,
    'AIC-M04': 10,
    'AIC-M05': 15,
    'AIC-M06': 10,
    'AIC-M07': 20,
  }
  for (const item of value.excluded_sets as Obj[]) {
    if (!object(item)) fail()
    exactKeys(item, ['set_id', 'set_revision', 'reasons'])
    strings(item, ['set_id'])
    revision(item, 'set_revision')
    stringList(item, ['reasons'])
    if (excluded.has(item.set_id as string) || included.includes(item.set_id as string)) fail()
    excluded.add(item.set_id as string)
  }
  for (const metric of metrics) {
    if (!object(metric)) fail()
    exactKeys(metric, ['metric_id', 'contributions', 'omitted_sets'])
    strings(metric, ['metric_id'])
    list(metric, ['contributions', 'omitted_sets'])
    const id = metric.metric_id as string,
      sets = new Set<string>(),
      periods = new Set<string>()
    if (!Object.hasOwn(maxima, id) || metricIds.has(id)) fail()
    metricIds.add(id)
    for (const part of metric.contributions as Obj[]) {
      if (!object(part) || !object(part.period)) fail()
      exactKeys(part, [
        'set_id',
        'set_revision',
        'period',
        'points',
        'raw_value',
        'source_fact_ids',
      ])
      exactKeys(part.period, ['kind', 'start_date', 'end_date'])
      strings(part, ['set_id', 'points'])
      revision(part, 'set_revision')
      stringList(part, ['source_fact_ids'])
      strings(part.period, ['kind', 'start_date', 'end_date'])
      const period = part.period,
        setId = part.set_id as string,
        year = (period.end_date as string).slice(0, 4)
      const validPeriod = profile
        ? isFullFiscalYear(period as { kind: string; start_date: string; end_date: string })
        : period.kind === 'FY' &&
          /^\d{4}$/.test(year) &&
          period.start_date === `${year}-01-01` &&
          period.end_date === `${year}-12-31`
      if (
        !validPeriod ||
        !/^\d+(\.\d{1,12})?$/.test(part.points as string) ||
        Number(part.points) > maxima[id] ||
        !included.includes(setId) ||
        sets.has(setId) ||
        periods.has(year) ||
        !(part.source_fact_ids as string[]).length ||
        (part.raw_value !== null &&
          (typeof part.raw_value !== 'string' || !/^-?\d+(\.\d+)?$/.test(part.raw_value)))
      )
        fail()
      sets.add(setId)
      periods.add(year)
      used.add(setId)
    }
    for (const item of metric.omitted_sets as Obj[]) {
      if (!object(item)) fail()
      exactKeys(item, ['set_id', 'blockers'])
      strings(item, ['set_id'])
      stringList(item, ['blockers'])
      if (sets.has(item.set_id as string)) fail()
    }
  }
  if (included.some((id) => !used.has(id))) fail()
  return value as CaseAggregation
}

export function assessment(value: unknown): Assessment {
  if (!object(value)) fail()
  if (value.checked_case_revision !== undefined) revision(value, 'checked_case_revision')
  for (const key of [
    'acknowledged_by',
    'acknowledged_at',
    'acknowledgement_reason',
    'financial_set_id',
  ])
    if (value[key] != null && typeof value[key] !== 'string') fail()
  strings(value, ['id', 'case_id', 'method_version', 'snapshot_hash', 'state', 'created_at'])
  if (value.purpose === 'company_health') {
    if (value.policy_version !== null || value.transaction_review !== null) fail()
  } else {
    if (value.purpose !== undefined) fail()
    strings(value, ['policy_version'])
  }
  if (value.case_aggregation !== undefined) {
    const aggregated = caseAggregation(value.case_aggregation)
    const version = aggregated.accounting_profile?.method_version ?? '1.0.0'
    if (
      value.purpose !== 'company_health' ||
      value.financial_set_id !== null ||
      value.method_version !== `AIC-FHI-1.0/${version}/mean_metric_points_v1`
    )
      fail()
  }
  revision(value, 'case_revision')
  list(value, ['factors'])
  stringList(value, ['strengths', 'weaknesses', 'red_flags', 'limitations'])
  if (typeof value.stale !== 'boolean') fail()
  nullableNumber(value.overall_score)
  if (value.grade != null || value.pd != null || value.PD != null) fail()
  if (value.financial_health !== undefined) {
    const health = value.financial_health
    if (!object(health)) fail()
    strings(health, ['status', 'score_quality'])
    list(health, ['components'])
    if (
      health.pd !== null ||
      (health.score !== null &&
        (typeof health.score !== 'string' || !/^\d+(\.\d+)?$/.test(health.score))) ||
      (health.band !== null &&
        (typeof health.band !== 'string' || !/^AIC-F[1-5]$/.test(health.band)))
    )
      fail()
    for (const key of ['blockers', 'missing_facts'])
      if (health[key] !== undefined) list(health, [key])
    for (const part of health.components as unknown[]) {
      if (!object(part)) fail()
      strings(part, ['metric_id', 'max_points'])
      stringList(part, ['source_facts'])
      for (const key of ['raw_value', 'points'])
        if (
          part[key] !== null &&
          (typeof part[key] !== 'string' || !/^-?\d+(\.\d+)?$/.test(part[key] as string))
        )
          fail()
      for (const key of ['formula_id', 'verification_state'])
        if (part[key] !== undefined && typeof part[key] !== 'string') fail()
      if (part.blockers !== undefined) list(part, ['blockers'])
      if (part.flags !== undefined) stringList(part, ['flags'])
    }
    if (health.partial_assessment !== undefined) {
      if (
        value.purpose !== 'company_health' ||
        health.status !== 'blocked' ||
        health.score !== null ||
        health.band !== null ||
        health.score_quality !== 'unavailable' ||
        value.overall_score != null
      )
        fail()
      partialAssessment(health.partial_assessment)
    }
  }
  if (value.transaction_review != null) {
    const review = value.transaction_review
    if (
      !object(review) ||
      !['BLOCKED', 'FOLLOW_UP', 'CLEAR_FOR_REVIEW', 'UNKNOWN'].includes(String(review.status)) ||
      !['RECEIVABLE', 'PREPAYMENT', 'LOAN', 'DEBT_INVESTMENT'].includes(
        String(review.exposure_kind),
      )
    )
      fail()
    list(review, ['findings'])
    for (const key of ['evidence_refs', 'limitations'])
      if (review[key] !== undefined) stringList(review, [key])
    for (const finding of review.findings as unknown[]) {
      if (!object(finding)) fail()
      strings(finding, ['code', 'severity', 'verification_state'])
      stringList(finding, ['evidence_refs'])
    }
  }
  for (const f of value.factors as unknown[]) {
    if (!object(f)) fail()
    strings(f, ['factor_id', 'label', 'status', 'rationale', 'verification_state'])
    stringList(f, ['evidence_refs', 'limitations'])
    if (
      !['available', 'missing', 'waived', 'conflicting', 'not_applicable'].includes(
        String(f.status),
      )
    )
      fail()
    nullableNumber(f.score)
  }
  return value as Assessment
}
export function detail(value: unknown): CaseDetail {
  caseRecord(value)
  const v = value as Obj
  for (const key of [
    'documents',
    'jobs',
    'findings',
    'issue_history',
    'waivers',
    'requests',
    'questionnaires',
    'financial_metrics',
  ]) {
    if (v[key] !== undefined && !Array.isArray(v[key])) fail()
  }
  if (v.readiness) readiness(v.readiness)
  if (v.assessment) assessment(v.assessment)
  for (const d of (v.documents ?? []) as unknown[]) {
    if (!object(d)) fail()
    strings(d, ['id', 'lineage', 'hash', 'owner_party_ref', 'type', 'status'])
    revision(d, 'version')
    if (!Number.isInteger(d.pages) || Number(d.pages) < 1) fail()
    if (d.extraction != null) extraction(d.extraction)
    if (d.source_review !== undefined) {
      const review = d.source_review
      if (
        !object(review) ||
        !['match', 'mismatch', 'unresolved'].includes(String(review.subject_match))
      )
        fail()
      strings(review, ['declared_type', 'reason', 'actor_id', 'created_at'])
      if (
        !Array.isArray(review.reviewed_pages) ||
        !review.reviewed_pages.length ||
        review.reviewed_pages.some(
          (page) => !Number.isInteger(page) || Number(page) < 1 || Number(page) > Number(d.pages),
        )
      )
        fail()
    }
  }
  for (const f of (v.findings ?? []) as unknown[]) finding(f)
  for (const f of (v.issue_history ?? []) as unknown[]) finding(f)
  for (const w of (v.waivers ?? []) as unknown[]) {
    if (!object(w)) fail()
    strings(w, ['id', 'actor_id', 'policy_version', 'created_at'])
    if (typeof w.active !== 'boolean') fail()
    for (const key of ['requirement_key', 'reason', 'revoked_at'])
      if (w[key] != null && typeof w[key] !== 'string') fail()
  }
  for (const m of (v.financial_metrics ?? []) as unknown[]) {
    if (!object(m)) fail()
    strings(m, ['metric_id', 'formula_id', 'period'])
    stringList(m, ['input_refs'])
    list(m, ['adjustments'])
    if (
      !['available', 'unavailable'].includes(String(m.status)) ||
      (m.value !== null && (typeof m.value !== 'string' || !/^-?\d+(\.\d+)?$/.test(m.value))) ||
      (m.reason != null && typeof m.reason !== 'string')
    )
      fail()
  }
  for (const j of (v.jobs ?? []) as unknown[]) job(j)
  for (const r of (v.requests ?? []) as unknown[]) {
    if (!object(r)) fail()
    strings(r, ['id', 'status'])
    revision(r)
  }
  for (const q of (v.questionnaires ?? []) as unknown[]) {
    if (!object(q)) fail()
    strings(q, ['id'])
    scopedForm(q)
    if (q.policy_version === 'MVP-OPTIONAL-TEXT-1') {
      for (const question of q.questions as Obj[]) {
        if (
          question.answer_type !== 'text' ||
          question.requiredness !== 'optional' ||
          question.allowed_to_skip !== true ||
          question.version !== 1 ||
          !object(question.source_requirements) ||
          question.source_requirements.skip_reason_required !== true
        )
          fail()
      }
    }
    if (q.responses !== undefined) {
      list(q, ['responses'])
      for (const r of q.responses as unknown[]) {
        if (!object(r)) fail()
        strings(r, ['id', 'question_id', 'answer_state', 'origin'])
        stringList(r, ['source_refs'])
        revision(r)
        if (!['staff_transcribed', 'SME_direct'].includes(String(r.origin))) fail()
        if (!['submitted', 'self_assessed', 'skipped'].includes(String(r.answer_state))) fail()
        if (
          r.verification_status !== undefined &&
          !['unverified', 'verified', 'conflicting'].includes(String(r.verification_status))
        )
          fail()
        if (r.verification_stale !== undefined && typeof r.verification_stale !== 'boolean') fail()
        if (r.verification_stale === true && r.verification_status !== 'unverified') fail()
        if (!(q.questions as Obj[]).some((question) => question.id === r.question_id)) fail()
        if (q.policy_version === 'MVP-OPTIONAL-TEXT-1') {
          strings(r, ['reported_reference', 'created_at', 'reason'])
          if (
            (r.origin === 'staff_transcribed'
              ? typeof r.entered_by !== 'string'
              : r.entered_by !== null || typeof r.invitation_id !== 'string') ||
            !['organization', 'counterparty'].includes(String(r.reported_by)) ||
            (r.answer_state === 'skipped'
              ? r.answer_json !== null
              : typeof r.answer_json !== 'string' || !r.answer_json.trim())
          )
            fail()
        }
      }
    }
  }
  return value as CaseDetail
}
export function job(value: unknown): Job {
  if (
    !object(value) ||
    !['queued', 'running', 'completed', 'partial', 'failed'].includes(String(value.state))
  )
    fail()
  strings(value, ['id'])
  return value as Job
}
export function evidence(value: unknown): Evidence {
  if (!object(value)) fail()
  strings(value, ['id', 'document_id', 'quote', 'source_hash'])
  revision(value, 'document_version')
  revision(value, 'page')
  return value as Evidence
}
export function review(value: unknown): ReviewRun {
  if (!object(value)) fail()
  strings(value, ['id', 'case_id', 'rules_version', 'policy_version', 'snapshot_hash'])
  revision(value, 'case_revision')
  list(value, ['findings'])
  ;(value.findings as unknown[]).forEach(finding)
  if (value.issue_history !== undefined) {
    list(value, ['issue_history'])
    ;(value.issue_history as unknown[]).forEach(finding)
  }
  job(value)
  if (typeof value.stale !== 'boolean') fail()
  return value as ReviewRun
}
export function history(value: unknown): HistoryEvent {
  if (!object(value)) fail()
  strings(value, ['id', 'actor', 'action', 'time'])
  list(value, ['subject_refs'])
  if (
    (value.revision_before !== null && !Number.isSafeInteger(value.revision_before)) ||
    (value.revision_after !== null && !Number.isSafeInteger(value.revision_after))
  )
    fail()
  return value as HistoryEvent
}

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const sha256Pattern = /^[0-9a-f]{64}$/

function uuid(v: Obj, key: string) {
  if (typeof v[key] !== 'string' || !uuidPattern.test(v[key] as string)) fail()
}

function nullableUuid(v: Obj, key: string) {
  if (v[key] !== null && (typeof v[key] !== 'string' || !uuidPattern.test(v[key] as string))) fail()
}

function sha256(v: Obj, key: string) {
  if (typeof v[key] !== 'string' || !sha256Pattern.test(v[key] as string)) fail()
}

export function extractionSummary(value: unknown): ExtractionSummary {
  if (!object(value)) fail()
  strings(value, ['document_id', 'source_hash', 'suggested_type'])
  revision(value, 'document_version')
  if (
    !['queued', 'running', 'completed', 'partial', 'failed'].includes(String(value.job_state)) ||
    !['live', 'mock'].includes(String(value.ai_mode)) ||
    value.verification !== 'unverified' ||
    !['financial_statements', 'contracts', 'tax', 'payments', 'other'].includes(
      String(value.group),
    ) ||
    value.classification_verification !== 'unverified' ||
    !['processing', 'ready_for_review', 'zero_usable_fields', 'failed'].includes(
      String(value.outcome),
    ) ||
    typeof value.total_fields !== 'number' ||
    typeof value.non_null_fields !== 'number' ||
    typeof value.usable_fields !== 'number' ||
    !Array.isArray(value.diagnostics) ||
    !Array.isArray(value.fields)
  ) {
    fail()
  }
  for (const d of value.diagnostics as unknown[]) {
    if (!object(d) || typeof d.code !== 'string') fail()
    if (d.field_key !== null && typeof d.field_key !== 'string') fail()
  }
  for (const f of value.fields as unknown[]) {
    if (!object(f) || typeof f.field_key !== 'string' || typeof f.has_value !== 'boolean') fail()
    if (!['readable', 'uncertain', 'unreadable'].includes(String(f.quality))) fail()
    if (f.missing_reason !== null && typeof f.missing_reason !== 'string') fail()
    if (typeof f.evidence_count !== 'number') fail()
  }
  return value as ExtractionSummary
}

export function dossierAccepted(value: unknown): DossierAccepted {
  if (!object(value)) fail()
  exactKeys(value, [
    'archive_id',
    'case_id',
    'archive_sha256',
    'revision',
    'intake_state',
    'manifest_url',
  ])
  uuid(value, 'archive_id')
  uuid(value, 'case_id')
  sha256(value, 'archive_sha256')
  revision(value, 'revision')
  if (value.intake_state !== 'queued') fail()
  if (
    typeof value.manifest_url !== 'string' ||
    !/^\/api\/v2\/dossier-archives\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value.manifest_url,
    )
  ) {
    fail()
  }
  return value as DossierAccepted
}

export function dossierCounters(value: unknown): DossierCounters {
  if (!object(value)) fail()
  const keys = [
    'discovered',
    'registered',
    'rejected',
    'awaiting_inspection',
    'queued',
    'running',
    'completed_with_usable_data',
    'completed_zero_usable',
    'failed',
    'needs_review',
  ]
  exactKeys(value, keys)
  for (const k of keys) {
    const num = value[k]
    if (!Number.isInteger(num) || (num as number) < 0 || (num as number) > 128) fail()
  }
  return value as DossierCounters
}

function decodeDossierArchiveSummary(value: unknown, withMembers: boolean): DossierArchiveSummary {
  if (!object(value)) fail()
  exactKeys(value, [
    'id',
    'case_id',
    'archive_sha256',
    'intake_state',
    'processing_state',
    'created_at',
    'counters',
    'error_code',
    ...(withMembers ? ['members'] : []),
  ])
  uuid(value, 'id')
  uuid(value, 'case_id')
  sha256(value, 'archive_sha256')
  if (
    !['queued', 'validating', 'registering', 'accepted', 'partially_accepted', 'rejected'].includes(
      String(value.intake_state),
    ) ||
    !['waiting', 'processing', 'finished', 'finished_with_errors'].includes(
      String(value.processing_state),
    )
  ) {
    fail()
  }
  dateTime(value.created_at)
  dossierCounters(value.counters)
  if (value.error_code !== null && typeof value.error_code !== 'string') fail()
  return value as DossierArchiveSummary
}

export function dossierArchiveSummary(value: unknown): DossierArchiveSummary {
  return decodeDossierArchiveSummary(value, false)
}

export function dossierMember(value: unknown): DossierMember {
  if (!object(value)) fail()
  exactKeys(value, [
    'id',
    'archive_id',
    'entry_index',
    'entry_path',
    'byte_size',
    'sha256',
    'detected_mime',
    'group',
    'suggested_type',
    'classification_verification',
    'period_suggestion',
    'subject_verification',
    'intake_state',
    'processing_state',
    'page_count',
    'document_id',
    'job_id',
    'error_code',
    'retryable',
    'source_url',
  ])
  uuid(value, 'id')
  uuid(value, 'archive_id')
  if (
    !Number.isInteger(value.entry_index) ||
    (value.entry_index as number) < 0 ||
    (value.entry_index as number) > 127
  )
    fail()
  if (typeof value.entry_path !== 'string' || value.entry_path.length < 1) fail()
  if (!Number.isSafeInteger(value.byte_size) || (value.byte_size as number) < 0) fail()
  if (
    value.sha256 !== null &&
    (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256))
  )
    fail()
  if (value.detected_mime !== null && typeof value.detected_mime !== 'string') fail()
  if (
    !['financial_statements', 'contracts', 'tax', 'payments', 'other'].includes(String(value.group))
  )
    fail()
  if (
    ![
      'registration',
      'loan_request',
      'financial_statement',
      'contract',
      'acceptance_record',
      'payment_record',
      'invoice',
      'other',
    ].includes(String(value.suggested_type))
  )
    fail()
  if (value.classification_verification !== 'unverified') fail()
  if (!object(value.period_suggestion)) fail()
  const ps = value.period_suggestion as Obj
  exactKeys(ps, ['year', 'kind', 'basis', 'verification'])
  if (ps.year !== null && !Number.isSafeInteger(ps.year)) fail()
  if (ps.kind !== 'unresolved' || ps.basis !== 'unresolved' || ps.verification !== 'unverified')
    fail()
  if (value.subject_verification !== 'unresolved') fail()
  if (
    !['awaiting_inspection', 'inspecting', 'registered', 'rejected', 'needs_review'].includes(
      String(value.intake_state),
    )
  )
    fail()
  if (
    ![
      'waiting',
      'queued',
      'running',
      'completed_with_usable_data',
      'completed_zero_usable',
      'failed',
      'needs_review',
      'not_applicable',
    ].includes(String(value.processing_state))
  )
    fail()
  if (
    value.page_count !== null &&
    (!Number.isSafeInteger(value.page_count) || (value.page_count as number) < 1)
  )
    fail()
  nullableUuid(value, 'document_id')
  nullableUuid(value, 'job_id')
  if (value.error_code !== null && typeof value.error_code !== 'string') fail()
  if (typeof value.retryable !== 'boolean') fail()
  if (
    value.source_url !== null &&
    (typeof value.source_url !== 'string' ||
      !/^\/api\/v2\/dossier-members\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/source$/.test(
        value.source_url,
      ))
  ) {
    fail()
  }
  return value as DossierMember
}

export function dossierArchive(value: unknown): DossierArchive {
  decodeDossierArchiveSummary(value, true)
  const v = value as Obj
  if (!Array.isArray(v.members) || v.members.length > 128) fail()
  for (const m of v.members) dossierMember(m)
  return value as DossierArchive
}

export function dossierArchiveList(value: unknown): DossierArchiveList {
  if (!Array.isArray(value) || value.length > 4) fail()
  for (const a of value) dossierArchiveSummary(a)
  return value as DossierArchiveList
}

export function dossierMemberSummary(value: unknown): DossierMemberSummary {
  if (!object(value)) fail()
  exactKeys(value, [
    'member_id',
    'archive_id',
    'document_id',
    'job_id',
    'intake_state',
    'processing_state',
    'error_code',
    'extraction',
  ])
  uuid(value, 'member_id')
  uuid(value, 'archive_id')
  nullableUuid(value, 'document_id')
  nullableUuid(value, 'job_id')
  if (
    !['awaiting_inspection', 'inspecting', 'registered', 'rejected', 'needs_review'].includes(
      String(value.intake_state),
    )
  )
    fail()
  if (
    ![
      'waiting',
      'queued',
      'running',
      'completed_with_usable_data',
      'completed_zero_usable',
      'failed',
      'needs_review',
      'not_applicable',
    ].includes(String(value.processing_state))
  )
    fail()
  if (value.error_code !== null && typeof value.error_code !== 'string') fail()
  if (value.extraction !== null) extractionSummary(value.extraction)
  return value as DossierMemberSummary
}
