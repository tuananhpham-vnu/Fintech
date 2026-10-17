const test = require('node:test'),
  assert = require('node:assert/strict')
const { randomUUID, randomBytes } = require('node:crypto')
const { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')

test('MVP policy/Exposure migration: real PostgreSQL constraints, synthetic unapproved fixtures', async (t) => {
  assert.ok(process.env.AIC_TEST_DATABASE_URL, 'Explicit disposable PostgreSQL URL required')
  const source = new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) &&
      process.env.AIC_ALLOW_LOCAL_DB_TESTS === 'true',
  )
  const name = 'aic_policy_test_' + randomBytes(8).toString('hex'),
    admin = new Client({ connectionString: source.href })
  let owner,
    databaseCreated = false
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${name}`)
    databaseCreated = true
    const url = new URL(source)
    url.pathname = '/' + name
    await migrate(url.href)
    owner = new Client({ connectionString: url.href })
    await owner.connect()
    const org = randomUUID(),
      otherOrg = randomUUID(),
      user = randomUUID(),
      foreignUser = randomUUID(),
      cp = randomUUID(),
      caseId = randomUUID(),
      secondCase = randomUUID()
    const version = 'SYNTHETIC-UNAPPROVED-CONSTRAINT-TEST',
      hash = 'a'.repeat(64),
      otherHash = 'b'.repeat(64)
    for (const id of [org, otherOrg])
      await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)', [
        id,
        'SYNTHETIC TECH TEST',
      ])
    for (const [id, organization] of [
      [user, org],
      [foreignUser, otherOrg],
    ])
      await owner.query(
        "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,'unused-no-login','SYNTHETIC','specialist')",
        [id, organization, randomUUID()],
      )
    await owner.query(
      "INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC','VN')",
      [cp, org],
    )
    async function insertCase(id, policy = 'SYNTHETIC-UNAPPROVED-HISTORICAL', pinned = null) {
      return owner.query(
        "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,policy_artifact_hash,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4,$5,$6,$7)",
        [
          id,
          org,
          cp,
          {
            amount_vnd: '1',
            term_days: null,
            organization_role: 'seller',
            counterparty_role: 'buyer',
          },
          policy,
          pinned,
          user,
        ],
      )
    }
    await insertCase(caseId)
    await insertCase(secondCase)
    // Timestamp columns below are synthetic SQL constraint fixtures; the JSON expressly
    // records no policy approval. No real artifact or business decision is provisioned.
    await owner.query(
      'INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from) VALUES($1,$2,$3,$4,$5)',
      [
        version,
        hash,
        {
          synthetic: true,
          approval_status: 'unapproved',
          purpose: 'database-constraint-test-only',
        },
        '2026-01-01T00:00:00Z',
        '2026-01-02T00:00:00Z',
      ],
    )
    const assignmentSql =
      'INSERT INTO aic.mvp_policy_assignments(id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from,effective_until) VALUES($1,$2,$3,$4,$5,$6,$7)'
    const assignment = (
      start,
      until,
      organization = org,
      kind = 'RECEIVABLE',
      artifactHash = hash,
    ) => [randomUUID(), organization, version, artifactHash, kind, start, until]
    const violation = (code) => (error) => error.code === code

    await t.test(
      'explicit organization registry allows adjacency/other kind/other org and has no implicit match',
      async () => {
        await owner.query(assignmentSql, assignment('2026-02-01', '2026-03-01'))
        await owner.query(assignmentSql, assignment('2026-03-01', '2026-04-01'))
        await owner.query(assignmentSql, assignment('2026-02-01', null, org, 'PREPAYMENT'))
        await owner.query(assignmentSql, assignment('2026-02-01', null, otherOrg))
        const match = (date) =>
          owner.query(
            `SELECT * FROM aic.mvp_policy_assignments WHERE organization_id=$1
        AND exposure_kind=$2 AND effective_from<=$3 AND (effective_until IS NULL OR effective_until>$3)`,
            [org, 'RECEIVABLE', date],
          )
        assert.equal((await match('2026-03-01')).rowCount, 1)
        assert.equal((await match('2026-05-01')).rowCount, 0)
      },
    )
    await t.test(
      'overlap, invalid intervals, pre-effective assignment, unsupported kind and wrong hash fail closed',
      async () => {
        await assert.rejects(
          owner.query(assignmentSql, assignment('2026-02-15', '2026-03-15')),
          violation('23P01'),
        )
        await assert.rejects(
          owner.query(assignmentSql, assignment('2026-05-01', '2026-05-01')),
          violation('23514'),
        )
        await assert.rejects(
          owner.query(assignmentSql, assignment('2025-01-01', '2025-02-01')),
          violation('23514'),
        )
        await assert.rejects(
          owner.query(assignmentSql, assignment('2026-05-01', null, org, 'LOAN')),
          violation('23514'),
        )
        await assert.rejects(
          owner.query(assignmentSql, assignment('2026-05-01', null, org, 'RECEIVABLE', otherHash)),
          violation('23503'),
        )
      },
    )
    await t.test('advisory lock prevents concurrent overlapping registry insertions', async () => {
      const a = new Client({ connectionString: url.href }),
        b = new Client({ connectionString: url.href })
      await a.connect()
      await b.connect()
      try {
        await a.query('BEGIN')
        await b.query('BEGIN')
        await a.query(assignmentSql, assignment('2026-06-01', '2026-08-01'))
        const pending = b.query(assignmentSql, assignment('2026-07-01', '2026-09-01')).then(
          () => null,
          (error) => error,
        )
        await a.query('COMMIT')
        assert.equal((await pending).code, '23P01')
        await b.query('ROLLBACK')
      } finally {
        await a.end()
        await b.end()
      }
    })
    await t.test(
      'case pin references exact artifact pair; historical null and pinned content cannot change',
      async () => {
        const pinned = randomUUID()
        await insertCase(pinned, version, hash)
        await assert.rejects(insertCase(randomUUID(), version, otherHash), violation('23503'))
        await assert.rejects(
          owner.query('UPDATE aic.cases SET policy_artifact_hash=$2 WHERE id=$1', [pinned, null]),
          violation('23514'),
        )
        await assert.rejects(
          owner.query('UPDATE aic.cases SET policy_artifact_hash=$2 WHERE id=$1', [caseId, hash]),
          violation('23514'),
        )
        assert.equal(
          (await owner.query('SELECT policy_artifact_hash FROM aic.cases WHERE id=$1', [caseId]))
            .rows[0].policy_artifact_hash,
          null,
        )
      },
    )
    const declaration = randomUUID(),
      otherDeclaration = randomUUID(),
      document = randomUUID(),
      lineage = randomUUID(),
      documentHash = 'c'.repeat(64)
    const versionSql =
      'INSERT INTO aic.mvp_exposure_versions(organization_id,case_id,revision,source_id,aggregate_json,entered_by) VALUES($1,$2,$3,$4,$5,$6)'
    const bindingSql =
      'INSERT INTO aic.mvp_exposure_source_bindings(organization_id,case_id,exposure_revision,binding_id,source_kind,source_id,document_version,document_sha256,evidence_ref,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
    const binding = (kind, id, version = null, digest = null) => [
      org,
      caseId,
      1,
      randomUUID(),
      kind,
      id,
      version,
      digest,
      null,
      'organization',
    ]
    await t.test(
      'immutable declaration/version source has real author provenance and case/tenant FKs',
      async () => {
        await owner.query(versionSql, [
          org,
          caseId,
          1,
          declaration,
          { synthetic: true, verification: 'unverified' },
          user,
        ])
        await owner.query(versionSql, [
          org,
          secondCase,
          1,
          otherDeclaration,
          { synthetic: true, verification: 'unverified' },
          user,
        ])
        await owner.query(bindingSql, binding('declaration', declaration))
        await assert.rejects(
          owner.query(bindingSql, binding('declaration', otherDeclaration)),
          violation('23503'),
        )
        await assert.rejects(
          owner.query(bindingSql, binding('declaration', randomUUID())),
          violation('23503'),
        )
        await assert.rejects(
          owner.query(versionSql, [org, caseId, 2, randomUUID(), {}, foreignUser]),
          violation('23503'),
        )
        await assert.rejects(
          owner.query(bindingSql, binding('declaration', declaration, 1, documentHash)),
          violation('23514'),
        )
      },
    )
    await t.test(
      'document source requires exact immutable ID/version/hash in the same case',
      async () => {
        const { createHash } = require('node:crypto'),
          bytes = Buffer.from('SYNTHETIC CANONICAL BYTES'),
          sha = createHash('sha256').update(bytes).digest('hex')
        await owner.query('BEGIN')
        try {
          await owner.query(
            'INSERT INTO aic.mvp_document_objects(organization_id,case_id,document_id,sha256,byte_size,bytes) VALUES($1,$2,$3,$4,$5,$6)',
            [org, caseId, document, sha, bytes.length, bytes],
          )
          await owner.query(
            'INSERT INTO aic.mvp_document_lineages(organization_id,case_id,id,current_document_id) VALUES($1,$2,$3,$4)',
            [org, caseId, lineage, document],
          )
          await owner.query(
            "INSERT INTO aic.mvp_documents(id,organization_id,case_id,lineage,version,hash,byte_size,pages,name,type,source_class,ai_mode,created_by) VALUES($1,$2,$3,$4,1,$5,$6,1,'synthetic','other','synthetic','mock',$7)",
            [document, org, caseId, lineage, sha, bytes.length, user],
          )
          await owner.query('COMMIT')
        } catch (error) {
          await owner.query('ROLLBACK')
          throw error
        }
        await owner.query(bindingSql, binding('document', document, 1, sha))
        await assert.rejects(
          owner.query(bindingSql, binding('document', document, 2, sha)),
          violation('23503'),
        )
        await assert.rejects(
          owner.query(bindingSql, binding('document', document, 1, documentHash)),
          violation('23503'),
        )
        await assert.rejects(
          owner.query(bindingSql, binding('document', document)),
          violation('23514'),
        )
        await assert.rejects(
          owner.query(bindingSql, [
            org,
            secondCase,
            1,
            randomUUID(),
            'document',
            document,
            1,
            sha,
            null,
            'counterparty',
          ]),
          violation('23503'),
        )
      },
    )
    await t.test(
      'policy registry and Exposure/source versions reject UPDATE DELETE TRUNCATE without extra function grants',
      async () => {
        for (const table of [
          'mvp_policy_artifacts',
          'mvp_policy_assignments',
          'mvp_exposure_versions',
          'mvp_exposure_source_bindings',
        ]) {
          await assert.rejects(owner.query(`DELETE FROM aic.${table}`), violation('55000'))
          await assert.rejects(owner.query(`TRUNCATE aic.${table} CASCADE`), violation('55000'))
        }
        await assert.rejects(
          owner.query('UPDATE aic.mvp_policy_artifacts SET artifact_json=artifact_json'),
          violation('55000'),
        )
        await assert.rejects(
          owner.query('UPDATE aic.mvp_policy_assignments SET effective_from=effective_from'),
          violation('55000'),
        )
        await assert.rejects(
          owner.query('UPDATE aic.mvp_exposure_versions SET aggregate_json=aggregate_json'),
          violation('55000'),
        )
        await assert.rejects(
          owner.query('UPDATE aic.mvp_exposure_source_bindings SET source_id=source_id'),
          violation('55000'),
        )
        const functions = await owner.query(
          "SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='aic' AND p.proname IN ('check_mvp_policy_assignment','reject_mvp_case_policy_hash_change','reject_mvp_policy_exposure_mutation')",
        )
        assert.equal(functions.rows.length, 3)
        assert.ok(functions.rows.every((row) => !row.prosecdef))
      },
    )
    await t.test(
      '0006 creator trigger permits runtime case INSERT without membership/user DML',
      async () => {
        const role = 'aic_creator_' + randomBytes(6).toString('hex')
        await owner.query(
          `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        )
        try {
          await owner.query(`GRANT USAGE ON SCHEMA aic TO ${role}`)
          await owner.query(`GRANT INSERT ON aic.cases TO ${role}`)
          const created = randomUUID()
          await owner.query(`SET ROLE ${role}`)
          try {
            await insertCase(created)
          } finally {
            await owner.query('RESET ROLE')
          }
          assert.equal(
            (
              await owner.query(
                'SELECT count(*)::int n FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2',
                [created, user],
              )
            ).rows[0].n,
            1,
          )
          for (const table of ['users', 'case_memberships']) {
            assert.equal(
              (
                await owner.query('SELECT has_table_privilege($1,$2,$3) allowed', [
                  role,
                  'aic.' + table,
                  'UPDATE',
                ])
              ).rows[0].allowed,
              false,
            )
            assert.equal(
              (
                await owner.query('SELECT has_table_privilege($1,$2,$3) allowed', [
                  role,
                  'aic.' + table,
                  'INSERT',
                ])
              ).rows[0].allowed,
              false,
            )
          }
          const fn = (
            await owner.query(
              "SELECT prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='aic' AND p.proname='grant_case_creator_membership'",
            )
          ).rows[0]
          assert.equal(fn.prosecdef, true)
          assert.deepEqual(fn.proconfig, ['search_path=pg_catalog'])
          assert.equal(
            (
              await owner.query('SELECT has_function_privilege($1,$2,$3) allowed', [
                role,
                'aic.grant_case_creator_membership()',
                'EXECUTE',
              ])
            ).rows[0].allowed,
            false,
          )
        } finally {
          await owner.query(`DROP OWNED BY ${role}`)
          await owner.query(`DROP ROLE ${role}`)
        }
      },
    )
    await t.test(
      '0006 null amount requires a reason; zero, absent and malformed amounts stay rejected',
      async () => {
        const exposure = {
          amount_vnd: null,
          amount_missing_reason: 'source unavailable',
          term_days: null,
          organization_role: 'seller',
          counterparty_role: 'buyer',
        }
        await owner.query('UPDATE aic.cases SET exposure_json=$2 WHERE id=$1', [caseId, exposure])
        for (const invalid of [
          { ...exposure, amount_missing_reason: '' },
          { ...exposure, amount_missing_reason: '  ' },
          { ...exposure, amount_missing_reason: null },
          { ...exposure, amount_vnd: '0' },
          { ...exposure, amount_vnd: 1 },
          { term_days: null, organization_role: 'seller', counterparty_role: 'buyer' },
        ])
          await assert.rejects(
            owner.query('UPDATE aic.cases SET exposure_json=$2 WHERE id=$1', [caseId, invalid]),
            violation('23514'),
          )
      },
    )
    await t.test(
      '0006 workflow publication stays frozen while request revision advances; history/waivers remain immutable',
      async () => {
        const { createHash } = require('node:crypto'),
          run = randomUUID(),
          request = randomUUID(),
          actor = user,
          issue = randomUUID()
        await owner.query(
          'INSERT INTO aic.mvp_review_runs(id,organization_id,case_id,case_revision,snapshot_hash,policy_version,payload_json) VALUES($1,$2,$3,1,$4,$5,$6)',
          [run, org, caseId, 'd'.repeat(64), version, { synthetic: true, conclusion: 'unknown' }],
        )
        await owner.query(
          `INSERT INTO aic.mvp_document_requests(id,organization_id,case_id,run_id,issue_id,purpose,content,document_types,status,revision,created_by)
        VALUES($1,$2,$3,$4,$5,'synthetic','synthetic',$6,'draft',1,$7)`,
          [request, org, caseId, run, issue, JSON.stringify(['other']), user],
        )
        await owner.query(
          'INSERT INTO aic.mvp_request_history(id,organization_id,case_id,request_id,request_revision,payload_json,actor_id) VALUES($1,$2,$3,$4,1,$5,$6)',
          [
            randomUUID(),
            org,
            caseId,
            request,
            { status: 'draft', verification: 'unverified' },
            user,
          ],
        )
        const bytes = Buffer.from('SYNTHETIC REQUEST CONTENT'),
          hash = createHash('sha256').update(bytes).digest('hex')
        await owner.query(
          "UPDATE aic.mvp_document_requests SET status='approved',revision=2,approved_payload=$2,approved_export=$3,approved_hash=$4 WHERE id=$1",
          [request, { synthetic: true, verification: 'unverified' }, bytes, hash],
        )
        await assert.rejects(
          owner.query('UPDATE aic.mvp_document_requests SET revision=3,content=$2 WHERE id=$1', [
            request,
            'changed',
          ]),
          violation('23514'),
        )
        await assert.rejects(
          owner.query(
            'UPDATE aic.mvp_document_requests SET revision=3,approved_export=$2 WHERE id=$1',
            [request, Buffer.from('changed')],
          ),
          violation('23514'),
        )
        await assert.rejects(
          owner.query('UPDATE aic.mvp_document_requests SET revision=4 WHERE id=$1', [request]),
          violation('23514'),
        )
        await owner.query(
          'INSERT INTO aic.mvp_response_bindings(organization_id,case_id,request_id,request_revision,request_hash,document_id) VALUES($1,$2,$3,2,$4,$5)',
          [org, caseId, request, hash, document],
        )
        await owner.query(
          "UPDATE aic.mvp_document_requests SET revision=3,status='closed' WHERE id=$1",
          [request],
        )
        assert.deepEqual(
          (
            await owner.query('SELECT approved_export FROM aic.mvp_document_requests WHERE id=$1', [
              request,
            ])
          ).rows[0].approved_export,
          bytes,
        )
        const waiver = randomUUID()
        await owner.query(
          'INSERT INTO aic.mvp_waivers(id,organization_id,case_id,requirement_key,issue_id,reason,policy_version,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [waiver, org, caseId, 'synthetic_requirement', issue, 'synthetic reason', version, actor],
        )
        await owner.query(
          'INSERT INTO aic.mvp_waiver_revocations(id,organization_id,case_id,waiver_id,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), org, caseId, waiver, 'synthetic revocation', actor],
        )
        for (const table of [
          'mvp_review_runs',
          'mvp_request_history',
          'mvp_response_bindings',
          'mvp_waivers',
          'mvp_waiver_revocations',
        ]) {
          await assert.rejects(owner.query(`DELETE FROM aic.${table}`), violation('55000'))
          await assert.rejects(owner.query(`TRUNCATE aic.${table} CASCADE`), violation('55000'))
        }
        await assert.rejects(
          owner.query('DELETE FROM aic.mvp_document_requests'),
          violation('55000'),
        )
      },
    )
  } finally {
    if (owner) await owner.end()
    if (databaseCreated) await admin.query(`DROP DATABASE ${name}`)
    await admin.end()
  }
})
