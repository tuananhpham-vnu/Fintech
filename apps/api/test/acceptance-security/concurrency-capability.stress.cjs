const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes } = require('node:crypto')
const { fixture, code, rejects, hash, until } = require('./harness.cjs')

// Commit gates pause only the test transaction wrapper after real service SQL.
// They do not replace business methods, locks, authorization, or runtime grants.
async function ordered(f, pattern, firstWork, waitingWork, blockedCount) {
  const gate = f.apiDb.holdCommit(pattern)
  const first = Promise.allSettled([firstWork()])
  let waiting
  try {
    let entered = false, finished = false
    gate.reached.then(() => { entered = true })
    first.then(() => { finished = true })
    await until(() => entered || finished, 'Winning transaction did not reach commit gate')
    if (!entered) {
      const [result] = await first
      if (result.status === 'rejected') throw result.reason
      throw Error('Operation committed without reaching its expected SQL gate')
    }
    waiting = Promise.allSettled(waitingWork())
    await f.waitBlocked(blockedCount)
  } finally {
    gate.release()
    // Drain every operation even if synchronization/assertions failed.
    await first
    if (waiting) await waiting
  }
  return [(await first)[0], await waiting]
}

async function effects(f, x, submissions) {
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM aic.mvp_respondent_submissions WHERE invitation_id=$1', [x.id])).rows[0].n, submissions)
  const rows = (await f.owner.query('SELECT * FROM aic.mvp_staff_responses WHERE invitation_id=$1', [x.id])).rows
  assert.equal(rows.length, submissions * x.answers.answers.length)
  for (const r of rows) {
    assert.equal(r.origin, 'SME_direct')
    assert.equal(r.entered_by, null)
    assert.equal(r.reported_by, 'counterparty')
  }
  assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM aic.audit_events WHERE capability_id=$1 AND action='questionnaire.direct_response'", [x.id])).rows[0].n, submissions)
}

test('ACCEPT-BE capability stress under actual runtime grants', { timeout: 180000 }, async (t) => {
  const f = await fixture(t)
  for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
    for (const control of ['revoke', 'close', 'reissue']) {
      const pattern = control === 'close' ? /INSERT INTO aic\.mvp_questionnaire_events/ : /INSERT INTO aic\.mvp_invitation_revocations/
      function change(x, revision) {
        const body = { expected_revision: revision, reason: 'Synthetic concurrency control' }
        if (control === 'revoke') return f.capabilities.revoke(f.session, x.id, randomUUID(), body)
        if (control === 'close') return f.capabilities.close(f.session, x.form.id, randomUUID(), body)
        return f.capabilities.create(f.session, x.form.id, randomUUID(), { ...x.input, ...body })
      }
      await t.test(`${kind}: ${control} commits while 10 submissions wait`, async () => {
        const x = await f.invitation(kind), before = await f.revision(x.caseId)
        const [winner, losers] = await ordered(f, pattern, () => change(x, before),
          () => Array.from({ length: 10 }, () => f.capabilities.submit(x.token, '127.0.0.1', randomUUID(), x.answers)), 10)
        assert.equal(winner.status, 'fulfilled')
        assert.equal(winner.value.status, control === 'reissue' ? 201 : 200)
        for (const result of losers) { assert.equal(result.status, 'rejected'); assert.equal(code(result.reason), 'NOT_FOUND') }
        assert.equal(await f.revision(x.caseId), before + 1)
        await effects(f, x, 0)
        await rejects(f.capabilities.form(x.token, '127.0.0.1'), 'NOT_FOUND')
        if (control === 'reissue') assert.ok((await f.capabilities.form(winner.value.rawToken, '127.0.0.1')).questions.length)
      })
      await t.test(`${kind}: submission commits while ${control} and 9 competitors wait`, async () => {
        const x = await f.invitation(kind), before = await f.revision(x.caseId), key = randomUUID()
        const [winner, waiting] = await ordered(f, /INSERT INTO aic\.mvp_respondent_submissions/,
          () => f.capabilities.submit(x.token, '127.0.0.1', key, x.answers),
          () => [change(x, before), ...Array.from({ length: 9 }, () => f.capabilities.submit(x.token, '127.0.0.1', randomUUID(), x.answers))], 10)
        assert.equal(winner.status, 'fulfilled')
        assert.equal(winner.value.identity_assurance, 'self_reported_capability_only')
        assert.equal(waiting[0].status, 'rejected')
        assert.equal(code(waiting[0].reason), 'REVISION_CONFLICT')
        for (const result of waiting.slice(1)) { assert.equal(result.status, 'rejected'); assert.equal(code(result.reason), 'IDEMPOTENCY_CONFLICT') }
        assert.equal(await f.revision(x.caseId), before + 1)
        await effects(f, x, 1)
        // Retry the specialist action with the fresh revision, then reject even exact receipt replay.
        await change(x, await f.revision(x.caseId))
        await rejects(f.capabilities.submit(x.token, '127.0.0.1', key, x.answers), 'NOT_FOUND')
        await rejects(f.capabilities.form(x.token, '127.0.0.1'), 'NOT_FOUND')
        await effects(f, x, 1)
      })
    }
    await t.test(`${kind}: 10 same-key submissions return one exact receipt and one revision`, async () => {
      const x = await f.invitation(kind), before = await f.revision(x.caseId), key = randomUUID()
      const receipts = await Promise.all(Array.from({ length: 10 }, () => f.capabilities.submit(x.token, '127.0.0.1', key, x.answers)))
      for (const receipt of receipts) assert.deepEqual(receipt, receipts[0])
      assert.equal(await f.revision(x.caseId), before + 1)
      await effects(f, x, 1)
      const changed = structuredClone(x.answers)
      changed.answers[0].answer_json = 'Changed synthetic content'
      await rejects(f.capabilities.submit(x.token, '127.0.0.1', key, changed), 'IDEMPOTENCY_CONFLICT')
      assert.equal(await f.revision(x.caseId), before + 1)
      // Hash-only storage and no raw token in persisted invitation/audit/idempotency JSON.
      const stored = (await f.owner.query('SELECT row_to_json(i) AS body FROM aic.mvp_invitations i WHERE id=$1', [x.id])).rows[0].body
      assert.ok(stored.token_hash === hash(x.token), 'Stored capability hash must match')
      const history = await f.owner.query(`SELECT metadata_json::text AS body FROM aic.audit_events WHERE case_id=$1
        UNION ALL SELECT response_body::text FROM aic.idempotency_keys WHERE organization_id=$2`, [x.caseId, f.org])
      assert.ok(!JSON.stringify([stored, history.rows]).includes(x.token), 'Raw token must not persist')
    })
    await t.test(`${kind}: 10 different keys produce exactly one committed submission`, async () => {
      const x = await f.invitation(kind), before = await f.revision(x.caseId)
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => f.capabilities.submit(x.token, '127.0.0.1', randomUUID(), x.answers)))
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      const losers = results.filter((r) => r.status === 'rejected')
      assert.equal(losers.length, 9)
      for (const r of losers) assert.equal(code(r.reason), 'IDEMPOTENCY_CONFLICT')
      assert.equal(await f.revision(x.caseId), before + 1)
      await effects(f, x, 1)
    })
    await t.test(`${kind}: expiry is checked after an observed case-lock wait`, async () => {
      const x = await f.invitation(kind), before = await f.revision(x.caseId)
      // Append an operator-owned short-lived fixture; never disable immutable triggers or update an invitation.
      const token = randomBytes(32).toString('base64url'), id = randomUUID()
      await f.owner.query(`INSERT INTO aic.mvp_invitations(id,organization_id,case_id,questionnaire_id,questionnaire_version,
        question_ids,token_hash,reported_by,recipient_reference,created_at,expires_at,created_by)
        SELECT $1,organization_id,case_id,questionnaire_id,questionnaire_version,question_ids,$2,reported_by,
          recipient_reference,clock_timestamp(),clock_timestamp()+interval '3 seconds',created_by FROM aic.mvp_invitations WHERE id=$3`, [id, hash(token), x.id])
      let pending
      await f.owner.query('BEGIN')
      try {
        await f.owner.query('SELECT id FROM aic.cases WHERE id=$1 FOR UPDATE', [x.caseId])
        pending = Promise.allSettled(Array.from({ length: 10 }, () => f.capabilities.submit(token, '127.0.0.1', randomUUID(), x.answers)))
        await f.waitBlocked(10)
        await until(async () => (await f.owner.query('SELECT expires_at<=clock_timestamp() AS expired FROM aic.mvp_invitations WHERE id=$1', [id])).rows[0].expired,
          'Short-lived invitation did not expire')
      } finally {
        await f.owner.query('ROLLBACK')
        if (pending) await pending
      }
      for (const r of await pending) { assert.equal(r.status, 'rejected'); assert.equal(code(r.reason), 'NOT_FOUND') }
      assert.equal(await f.revision(x.caseId), before)
      await effects(f, { ...x, id }, 0)
      await rejects(f.capabilities.form(token, '127.0.0.1'), 'NOT_FOUND')
    })
  }
})
