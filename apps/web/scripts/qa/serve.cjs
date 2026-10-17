// Loopback-only FE test harness. Serves the unmodified Next production UI from
// port 3001 and synthetic /api/v2 responses on port 4800. No env overrides,
// production fallback, real OCR/rating, private data, or external services.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { writeReport } = require('../lib/report.cjs')
const base = require('../../tests/fixtures/aic-api.cjs')
const { port, uiPort, origin } = require('./config.cjs')
const id = base.id,
  clone = structuredClone
const parties = clone(base.parties),
  cases = clone(base.cases)
const sessions = new Map(),
  sources = new Map(),
  evidence = new Map(),
  runs = new Map(),
  assessments = new Map(),
  histories = new Map(),
  jobs = new Map(),
  memo = new Map(),
  conflicts = new Set()
const report = {
  scope: 'SYNTHETIC FRONTEND QA ONLY',
  startedAt: new Date().toISOString(),
  requests: [],
}
const fixturePdf = (name) => fs.readFileSync(path.join(__dirname, '../../tests/fixtures/pdf', name))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const questions = [
  {
    id: id(701),
    version: 1,
    label: 'QA · Business activities',
    answer_type: 'text',
    requiredness: 'required',
    allowed_to_skip: false,
    source_requirements: [],
    verification_policy: 'manual',
  },
  {
    id: id(702),
    version: 1,
    label: 'QA · Optional supporting information',
    answer_type: 'text',
    requiredness: 'optional',
    allowed_to_skip: true,
    source_requirements: [],
    verification_policy: 'manual',
  },
]
function document(c, name, type, bytes, predecessor) {
  const doc = {
    id: randomUUID(),
    lineage: predecessor?.lineage ?? randomUUID(),
    version: (predecessor?.version ?? 0) + 1,
    name,
    type,
    source: 'SYNTHETIC_QA',
    owner_party_ref: c.counterparty_id,
    hash: hash(bytes),
    pages: Math.max(1, (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length),
    classification: type,
    status: 'review_required',
    extraction: [],
  }
  const ev = {
    id: randomUUID(),
    document_id: doc.id,
    document_version: doc.version,
    source_hash: doc.hash,
    page: doc.pages,
    quote: 'FINTECHATHON / SYNTHETIC DEMO DOCUMENT',
  }
  sources.set(doc.id, bytes)
  evidence.set(ev.id, ev)
  doc.extraction = [
    {
      field_key: 'fixture.source_label',
      value: 'SYNTHETIC_QA',
      raw_value: 'SYNTHETIC_QA',
      quality: 'readable',
      evidence_refs: [ev.id],
    },
    {
      field_key: 'fixture.unreadable_value',
      value: null,
      raw_value: null,
      quality: 'unreadable',
      missing_reason: 'Unreadable field in synthetic transport test',
      evidence_refs: [ev.id],
    },
  ]
  c.documents.push(doc)
  return doc
}
function bump(c, action, reason, refs = []) {
  const before = c.revision
  c.revision++
  c.updated_at = new Date().toISOString()
  if (c.latest_review_run_id && runs.has(c.latest_review_run_id))
    runs.get(c.latest_review_run_id).stale = true
  if (c.assessment) c.assessment.stale = true
  const event = {
    id: randomUUID(),
    actor: 'QA specialist',
    action,
    reason,
    time: new Date().toISOString(),
    revision_before: before,
    revision_after: c.revision,
    subject_refs: refs,
  }
  histories.set(c.id, [event, ...(histories.get(c.id) ?? [])])
  return c.revision
}
function readiness(c) {
  const configured = c.policy_version === 'QA-METHOD-CONFIGURED'
  return {
    case_revision: c.revision,
    document_review_allowed: !c.jobs.some((j) => ['queued', 'running'].includes(j.state)),
    numeric_assessment_allowed: configured,
    method_status: configured ? 'configured_pilot' : 'unconfigured',
    blockers: configured ? [] : clone(base.readiness.blockers),
    limitations: ['SYNTHETIC QA RESPONSES — not a real assessment'],
    waivable_requirements: c.waivers.some((w) => w.active)
      ? []
      : [{ requirement_key: 'transaction.acceptance_record', label: 'QA · Acceptance record' }],
  }
}
document(cases[0], 'QA-SYNTHETIC-contract-v1.pdf', 'contract', fixturePdf('contract.pdf'))
cases[0].questionnaires = [
  {
    id: id(700),
    questions,
    responses: [
      {
        id: id(703),
        question_id: questions[0].id,
        answer_state: 'submitted',
        answer_json: 'Partner original statement — SYNTHETIC QA',
        origin: 'SME_direct',
        source_refs: [],
        revision: 1,
        verification_status: 'unverified',
      },
    ],
  },
]
cases[0].requests = [
  {
    id: id(801),
    revision: 1,
    status: 'draft',
    purpose: 'QA · Add acceptance evidence',
    content: 'Original approved-language payload. 原文. Nội dung gốc.',
    run_id: null,
    evidence_refs: [],
  },
  {
    id: id(802),
    revision: 1,
    status: 'approved',
    purpose: 'QA · Approved immutable request',
    content: 'APPROVED QA TEXT\r\n原文\nNội dung gốc.',
    approved_payload: 'APPROVED QA TEXT\r\n原文\nNội dung gốc.',
    evidence_refs: [],
  },
]
const failedJob = {
  id: id(901),
  state: 'failed',
  retryable: true,
  errors: [{ code: 'QA_PROVIDER_DOWN', message: 'SYNTHETIC QA provider failure' }],
}
cases[0].jobs.push(failedJob)
jobs.set(failedJob.id, { c: cases[0], job: failedJob })
for (let n = 3; n <= 7; n++) {
  const p = {
    ...clone(parties[0]),
    id: id(n),
    name: [
      'QA · Method configured',
      'QA · 403 action',
      'QA · 422 validation',
      'QA · 429 limit',
      'QA · 503 service',
    ][n - 3],
  }
  parties.push(p)
  const c = {
    ...clone(base.cases[0]),
    id: id(n + 10),
    counterparty_id: p.id,
    policy_version: n === 3 ? 'QA-METHOD-CONFIGURED' : 'AIC-TRANSPORT-TEST',
    exposure: {
      ...clone(base.cases[0].exposure),
      contract_ref: n >= 4 ? `QA-ERROR-${[403, 422, 429, 503][n - 4]}` : 'QA-SCORE',
    },
  }
  if (n === 3)
    document(c, 'QA-SYNTHETIC-financials.pdf', 'financial_statement', fixturePdf('financials.pdf'))
  cases.push(c)
}
function advanceJobs(c) {
  for (const job of c.jobs) {
    const entry = jobs.get(job.id)
    if (!entry?.finishAt || Date.now() < entry.finishAt) continue
    job.state = 'completed'
    job.retryable = false
    delete job.errors
    if (entry.doc) entry.doc.status = 'review_required'
    if (entry.run) entry.run.state = 'completed'
    if (entry.assessment) entry.assessment.state = 'completed'
    delete entry.finishAt
  }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin)
  if (url.pathname === '/__qa__/report' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(report))
  }
  if (!url.pathname.startsWith('/api/v2/')) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405)
      return res.end()
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: uiPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${uiPort}` },
      },
      (next) => {
        res.writeHead(next.statusCode, {
          ...next.headers,
          'x-aic-test-harness': 'SYNTHETIC-QA-ONLY',
        })
        next.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(503)
      res.end(`Start the Next production UI on loopback port ${uiPort}.`)
    })
    return req.pipe(upstream)
  }
  const p = url.pathname.slice('/api/v2'.length),
    log = { method: req.method, path: url.pathname, status: 0, at: new Date().toISOString() }
  report.requests.push(log)
  function send(status, body, headers = {}) {
    log.status = status
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-aic-test-harness': 'SYNTHETIC-QA-ONLY',
      ...headers,
    })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  function error(status, code, message = code) {
    send(status, { code, message, request_id: randomUUID(), details: null })
  }
  function bytes(value, type, disposition) {
    log.status = 200
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      ...(disposition ? { 'content-disposition': disposition } : {}),
    })
    res.end(value)
  }
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 11 * 1024 * 1024) return error(413, 'FILE_LIMIT')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  let input = {}
  if (req.headers['content-type']?.includes('application/json')) {
    try {
      input = JSON.parse(raw.toString())
    } catch {
      return error(400, 'INVALID_INPUT')
    }
  }
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)aic_fe_qa=([^;]+)/)?.[1],
    session = sessions.get(cookie)
  const write = req.method !== 'GET'
  if (write && req.headers.origin !== origin) return error(403, 'ORIGIN_REJECTED')
  if (p === '/respondent/form') {
    if (req.headers.authorization !== 'Bearer qa-capability-only') return error(404, 'NOT_FOUND')
    return send(200, { questions, expires_at: new Date(Date.now() + 3600000).toISOString() })
  }
  if (p === '/auth/login' && req.method === 'POST') {
    if (input.username === 'limited.specialist')
      return send(
        429,
        {
          code: 'RATE_LIMIT',
          message: 'QA login rate limit',
          request_id: randomUUID(),
          details: null,
        },
        { 'retry-after': '1' },
      )
    if (
      input.password !== 'TestOnly#2026' ||
      !['qa.specialist', 'expire.specialist', 'other.specialist'].includes(input.username)
    )
      return error(401, 'INVALID_CREDENTIALS')
    const key = randomUUID(),
      user = {
        ...base.session.user,
        ...(input.username === 'other.specialist' ? { id: id(102), organization_id: id(200) } : {}),
      },
      expires_at = new Date(
        Date.now() + (input.username === 'expire.specialist' ? 20000 : 3600000),
      ).toISOString()
    const value = { user, csrf_token: randomUUID(), expires_at }
    sessions.set(key, value)
    return send(200, value, { 'set-cookie': `aic_fe_qa=${key}; HttpOnly; SameSite=Strict; Path=/` })
  }
  if (!session || Date.parse(session.expires_at) <= Date.now()) return error(401, 'SESSION_EXPIRED')
  if (p === '/auth/me') return send(200, session)
  if (p === '/auth/logout' && req.method === 'POST') {
    sessions.delete(cookie)
    return send(204, undefined, {
      'set-cookie': 'aic_fe_qa=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/',
    })
  }
  if (
    write &&
    (req.headers['x-csrf-token'] !== session.csrf_token || !req.headers['idempotency-key'])
  )
    return error(403, 'MUTATION_GUARD')
  if (write) {
    const key = `${cookie}:${req.headers['idempotency-key']}`,
      fingerprint = hash(Buffer.from(req.method + p + raw.toString('base64'))),
      prior = memo.get(key)
    if (prior && prior !== fingerprint) return error(409, 'IDEMPOTENCY_CONFLICT')
    memo.set(key, fingerprint)
  }
  const page = (values) => {
    const start = Number(url.searchParams.get('cursor') ?? 0),
      limit = Math.min(20, Number(url.searchParams.get('limit') ?? 20))
    return {
      items: values.slice(start, start + limit),
      next_cursor: start + limit < values.length ? String(start + limit) : null,
    }
  }
  if (p === '/counterparties' && req.method === 'GET') return send(200, page(parties))
  if (p === '/counterparties' && req.method === 'POST') {
    if (!input.name?.trim()) return error(422, 'INVALID_INPUT')
    const value = { ...clone(parties[0]), ...input, id: randomUUID(), revision: 1 }
    parties.push(value)
    return send(201, value)
  }
  const party = parties.find((v) => p === '/counterparties/' + v.id)
  if (party && req.method === 'GET') return send(200, party)
  if (party && req.method === 'PATCH') {
    if (input.expected_revision !== party.revision) return error(409, 'REVISION_CONFLICT')
    Object.assign(party, input, {
      revision: party.revision + 1,
      updated_at: new Date().toISOString(),
    })
    return send(200, party)
  }
  if (p === '/cases' && req.method === 'GET') return send(200, page(cases))
  if (p === '/cases' && req.method === 'POST') {
    if (
      !parties.some((v) => v.id === input.counterparty_id) ||
      !/^[1-9]\d*$/.test(input.exposure?.amount_vnd ?? '')
    )
      return error(422, 'INVALID_INPUT')
    const value = {
      ...clone(base.cases[0]),
      ...input,
      id: randomUUID(),
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    cases.unshift(value)
    return send(201, value)
  }
  const c = cases.find((v) => p === '/cases/' + v.id || p.startsWith('/cases/' + v.id + '/')),
    suffix = c ? p.slice(('/cases/' + c.id).length) : ''
  if (c) advanceJobs(c)
  if (c && !suffix && req.method === 'GET') return send(200, { ...c, readiness: readiness(c) })
  if (c && suffix === '/readiness') return send(200, readiness(c))
  if (c && suffix === '/history') return send(200, page(histories.get(c.id) ?? []))
  if (c && suffix === '/exposure' && req.method === 'PATCH') {
    const forced = Number(c.exposure.contract_ref?.match(/^QA-ERROR-(\d+)$/)?.[1])
    if (forced) return error(forced, 'QA_FORCED_' + forced, 'Synthetic QA response ' + forced)
    if (!conflicts.has(c.id)) {
      conflicts.add(c.id)
      bump(c, 'qa_concurrent_update', 'Force one optimistic-concurrency conflict')
      return error(409, 'REVISION_CONFLICT')
    }
    if (input.expected_revision !== c.revision) return error(409, 'REVISION_CONFLICT')
    c.exposure = input.exposure
    bump(c, 'exposure_updated', 'QA update')
    return send(200, { ...c, readiness: readiness(c) })
  }
  if (c && suffix === '/documents' && req.method === 'POST') {
    let form
    try {
      form = await new Request('http://qa.invalid/upload', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] },
        body: raw,
      }).formData()
    } catch {
      return error(415, 'INVALID_MULTIPART')
    }
    if (Number(form.get('expected_revision')) !== c.revision) return error(409, 'REVISION_CONFLICT')
    const file = form.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') return error(422, 'FILE_REQUIRED')
    const content = Buffer.from(await file.arrayBuffer())
    if (content.length > 10 * 1024 * 1024) return error(413, 'FILE_LIMIT')
    if (content.subarray(0, 5).toString() !== '%PDF-') return error(415, 'PDF_REQUIRED')
    const mode = form.get('mode'),
      old = c.documents.find((d) => d.id === form.get('replaces_document_id')),
      request = c.requests.find(
        (r) => r.id === form.get('response_request_id') && r.status === 'approved',
      )
    if ((mode === 'replace' && !old) || (mode === 'response' && !request))
      return error(422, 'TARGET_REQUIRED')
    const pages = (content.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length
    if (!pages || pages > 10) return error(422, 'PAGE_LIMIT')
    const active = c.documents.filter((d) => !['superseded', 'retired'].includes(d.status))
    if (
      active.length + (old ? 0 : 1) > 10 ||
      active.reduce((n, d) => n + d.pages, 0) - (old?.pages ?? 0) + pages > 40
    )
      return error(413, 'CASE_LIMIT')
    if (old) old.status = 'superseded'
    const doc = document(c, file.name, form.get('type'), content, old)
    doc.status = 'processing'
    if (request) doc.response_request_id = request.id
    const job = { id: randomUUID(), state: 'queued', retryable: false }
    c.jobs.push(job)
    jobs.set(job.id, { c, doc, job, finishAt: Date.now() + 500 })
    bump(c, 'document_uploaded', 'Synthetic PDF uploaded', [doc.id])
    return send(202, { document: doc, job, revision: c.revision })
  }
  const doc = cases
    .flatMap((v) => v.documents)
    .find((d) => p.startsWith('/documents/' + d.id + '/'))
  if (doc && p.endsWith('/source')) return bytes(sources.get(doc.id), 'application/pdf')
  if (doc && p.endsWith('/extraction')) return send(200, doc.extraction)
  const ev = [...evidence.values()].find((e) => p === '/evidence/' + e.id)
  if (ev) return send(200, ev)
  const jobEntry = [...jobs.values()].find(
    (j) => p === '/jobs/' + j.job.id || p === '/jobs/' + j.job.id + '/retry',
  )
  if (jobEntry && p.endsWith('/retry')) {
    jobEntry.job.state = 'running'
    jobEntry.job.retryable = false
    jobEntry.finishAt = Date.now() + 500
    return send(202, { job: jobEntry.job })
  }
  if (jobEntry) {
    advanceJobs(jobEntry.c)
    return send(200, jobEntry.job)
  }
  if (c && suffix === '/review-runs' && req.method === 'POST') {
    if (input.expected_revision !== c.revision) return error(409, 'REVISION_CONFLICT')
    const finding = {
      id: randomUUID(),
      issue_key: 'qa.transaction.evidence',
      rule_id: c.exposure_kind === 'PREPAYMENT' ? 'AIC-R05' : 'AIC-R04',
      category: 'transaction',
      severity: 'high',
      summary: 'QA · Verify transaction evidence',
      evidence_refs: c.documents[0]?.extraction?.[0].evidence_refs ?? [],
      finding_state: 'open',
      handling_state: 'none',
      limitations: ['Synthetic finding for FE transport testing'],
    }
    const run = {
      id: randomUUID(),
      case_id: c.id,
      case_revision: c.revision,
      rules_version: 'QA-NOT-A-REAL-RULE-ENGINE',
      policy_version: c.policy_version,
      snapshot_hash: hash(Buffer.from(c.id + ':' + c.revision)),
      state: 'running',
      stale: false,
      findings: [finding],
    }
    c.latest_review_run_id = run.id
    c.findings = run.findings
    runs.set(run.id, run)
    const job = { id: randomUUID(), state: 'running', retryable: false }
    c.jobs.push(job)
    jobs.set(job.id, { c, run, job, finishAt: Date.now() + 500 })
    return send(202, { run_id: run.id, job_id: job.id })
  }
  const run = runs.get(p.replace('/review-runs/', ''))
  if (run) {
    advanceJobs(cases.find((v) => v.id === run.case_id))
    return send(200, run)
  }
  const issueCase = cases.find((v) =>
    v.findings.some((f) => p === '/issues/' + f.id + '/decisions'),
  )
  if (issueCase) {
    if (input.expected_revision !== issueCase.revision) return error(409, 'REVISION_CONFLICT')
    const issue = issueCase.findings.find((f) => p === '/issues/' + f.id + '/decisions')
    if (input.action === 'resolve' && !input.evidence_refs?.length)
      return error(422, 'EVIDENCE_REQUIRED')
    issue.finding_state = { resolve: 'verified_resolved', dismiss: 'dismissed', reopen: 'open' }[
      input.action
    ]
    histories.set(issueCase.id, [
      {
        id: randomUUID(),
        actor: 'QA specialist',
        action: input.action,
        reason: input.reason,
        time: new Date().toISOString(),
        revision_before: issueCase.revision,
        revision_after: issueCase.revision,
        subject_refs: [issue.id],
      },
      ...(histories.get(issueCase.id) ?? []),
    ])
    return send(200, { issue, revision: issueCase.revision })
  }
  if (c && suffix === '/waivers' && req.method === 'POST') {
    if (input.expected_revision !== c.revision) return error(409, 'REVISION_CONFLICT')
    const waiver = {
      id: randomUUID(),
      actor_id: session.user.id,
      policy_version: c.policy_version,
      active: true,
      created_at: new Date().toISOString(),
      requirement_key: input.requirement_key,
      reason: input.reason,
    }
    c.waivers.push(waiver)
    bump(c, 'waiver_created', input.reason, [waiver.id])
    for (const f of c.findings) f.handling_state = 'waived'
    return send(201, { waiver, revision: c.revision })
  }
  const waiverCase = cases.find((v) => v.waivers.some((w) => p === '/waivers/' + w.id + '/revoke'))
  if (waiverCase) {
    if (input.expected_revision !== waiverCase.revision) return error(409, 'REVISION_CONFLICT')
    const waiver = waiverCase.waivers.find((w) => p === '/waivers/' + w.id + '/revoke')
    waiver.active = false
    for (const f of waiverCase.findings) f.handling_state = 'none'
    bump(waiverCase, 'waiver_revoked', input.reason, [waiver.id])
    return send(200, { waiver, revision: waiverCase.revision })
  }
  if (c && suffix === '/assessments' && req.method === 'POST') {
    if (!readiness(c).numeric_assessment_allowed) return error(422, 'METHOD_UNCONFIGURED')
    if (input.expected_revision !== c.revision) return error(409, 'REVISION_CONFLICT')
    const assessment = {
      id: randomUUID(),
      case_id: c.id,
      case_revision: c.revision,
      method_version: 'QA-ONLY-NOT-A-RATING-METHOD',
      policy_version: c.policy_version,
      snapshot_hash: hash(Buffer.from(c.id + ':' + c.revision)),
      state: 'running',
      stale: false,
      factors: [
        {
          factor_id: 'finance',
          label: 'QA · Financial profile',
          score: '70',
          value: 'SYNTHETIC',
          status: 'available',
          rationale:
            'Synthetic explanation returned by the QA service, not generated or scored by FE.',
          evidence_refs: c.documents[0]?.extraction?.[0].evidence_refs ?? [],
          verification_state: 'unverified',
          limitations: ['No credit meaning'],
        },
      ],
      financial_health: clone(base.financialHealth),
      transaction_review: {
        exposure_kind: c.exposure_kind,
        status: 'UNKNOWN',
        findings: [],
        evidence_refs: [],
        limitations: ['SYNTHETIC QA — transaction disposition is not inferred from FHI'],
      },
      grade: null,
      strengths: ['Synthetic QA strength'],
      weaknesses: ['Synthetic QA weakness'],
      red_flags: ['SYNTHETIC DATA — NO CREDIT DECISION'],
      limitations: ['UI transport testing only'],
      created_at: new Date().toISOString(),
    }
    c.assessment = assessment
    c.latest_assessment_id = assessment.id
    assessments.set(assessment.id, assessment)
    const job = { id: randomUUID(), state: 'running', retryable: false }
    c.jobs.push(job)
    jobs.set(job.id, { c, assessment, job, finishAt: Date.now() + 500 })
    return send(202, { assessment_id: assessment.id, job_id: job.id })
  }
  const assessment = [...assessments.values()].find(
    (a) => p === '/assessments/' + a.id || p === '/assessments/' + a.id + '/acknowledge',
  )
  if (assessment && p.endsWith('/acknowledge')) {
    const caseValue = cases.find((v) => v.id === assessment.case_id)
    if (input.expected_revision !== caseValue.revision || assessment.stale)
      return error(409, 'STALE_ASSESSMENT')
    histories.set(caseValue.id, [
      {
        id: randomUUID(),
        actor: 'QA specialist',
        action: 'assessment_acknowledged',
        reason: input.reason,
        time: new Date().toISOString(),
        revision_before: caseValue.revision,
        revision_after: caseValue.revision,
        subject_refs: [assessment.id],
      },
      ...(histories.get(caseValue.id) ?? []),
    ])
    return send(200, { acknowledged: true, revision: caseValue.revision })
  }
  if (assessment) {
    advanceJobs(cases.find((v) => v.id === assessment.case_id))
    return send(200, assessment)
  }
  const requestCase = cases.find((v) =>
    v.requests.some((r) => p.startsWith('/requests/' + r.id + '/')),
  )
  if (requestCase) {
    const value = requestCase.requests.find((r) => p.startsWith('/requests/' + r.id + '/'))
    if (p.endsWith('/export') && value.approved_payload !== undefined)
      return bytes(
        Buffer.from(value.approved_payload),
        'text/plain;charset=utf-8',
        'attachment; filename="qa-approved.txt"',
      )
    if (input.expected_revision !== requestCase.revision) return error(409, 'REVISION_CONFLICT')
    if (p.endsWith('/approve')) {
      value.status = 'approved'
      value.approved_payload = value.content
      value.revision++
    } else if (p.endsWith('/cancel')) value.status = 'cancelled'
    else return error(404, 'NOT_FOUND')
    bump(requestCase, 'request_' + value.status, input.reason, [value.id])
    return send(200, { request: value, revision: requestCase.revision })
  }
  return error(404, 'NOT_FOUND')
})
server.listen(port, '127.0.0.1', () =>
  console.log(
    `SYNTHETIC FE QA: ${origin} — UI upstream 127.0.0.1:${uiPort}. No production API configuration changed.`,
  ),
)
function shutdown() {
  writeReport('qa-http-observations.json', report)
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
