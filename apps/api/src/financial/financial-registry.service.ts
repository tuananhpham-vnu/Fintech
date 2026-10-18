import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { CaseMutations } from '../foundation/case-mutations'
import { canonicalJson, requestHash } from '../foundation/canonical'
import { CoreRepository, requireUuid } from '../foundation/core.repository'
import { FoundationError, notFound } from '../foundation/errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from '../foundation/ports'
import type {
  AuthSession,
  FoundationConfig,
  FoundationDatabase,
  SqlClient,
} from '../foundation/ports'
import { validateContract } from '../foundation/validation'
import { projectLegacyExtraction } from '../documents/evidence-projection'
import { Decimal } from './decimal'
import { scoreFhi } from './fhi-scorer'
import type { FhiInput, FhiFinancialFact, FhiScope } from './fhi-scorer'
import { FHI_METRICS } from './fhi-method'

const fail = (code: string, status = 422): never => {
  throw new FoundationError(status, code)
}
const iso = (value: Date | string) => new Date(value).toISOString()
@Injectable()
export class FinancialRegistry {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
  ) {}
  private input(name: string, body: unknown): any {
    const input = JSON.parse(canonicalJson(body))
    validateContract(name, input)
    return input
  }
  private output(name: string, body: any): any {
    validateContract(name, body, true)
    return body
  }
  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    const check = async () => {
      if (
        !(
          await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
            session.id,
            session.user.id,
            session.user.organization_id,
            this.config.sessionIdleMs,
          ])
        ).rows[0]
      )
        fail('SESSION_EXPIRED', 401)
    }
    await check()
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, true)
    await check()
    return current
  }
  private async source(
    tx: SqlClient,
    current: any,
    input: any,
    reviewed: boolean,
  ): Promise<boolean> {
    if (input.kind === 'manual_entry') return true
    const doc = (
      await tx.query(
        `SELECT d.*,r.raw_extraction AS extraction,(l.current_document_id=d.id) AS active FROM aic.mvp_documents d
      JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.id=d.lineage
      LEFT JOIN aic.mvp_document_results r ON r.organization_id=d.organization_id AND r.case_id=d.case_id AND r.document_id=d.id AND r.outcome='published'
      WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3 AND d.version=$4 AND d.hash=$5`,
        [
          current.organization_id,
          current.id,
          input.document_id,
          input.document_version,
          input.source_hash,
        ],
      )
    ).rows[0]
    if (!doc?.extraction || !doc.active) return false
    let projection
    try {
      projection = projectLegacyExtraction(doc, doc.extraction)
    } catch {
      return false
    }
    if (
      !projection.evidence.some(
        (e) => e.id === input.evidence_ref && e.page === input.page && e.quote === input.quote,
      )
    )
      return false
    if (!reviewed) return true
    const human = (
      await tx.query(
        "SELECT payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND kind='classification' ORDER BY case_revision DESC LIMIT 1",
        [current.organization_id, current.id, doc.id],
      )
    ).rows[0]?.payload_json
    const cp = (
      await tx.query(
        'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0]
    return (
      human?.subject_match === 'match' &&
      human.reviewed_pages.includes(input.page) &&
      Number(human.counterparty_revision) === Number(cp.revision)
    )
  }
  private async snapshot(tx: SqlClient, current: any, facts: any[]) {
    const cp = (
      await tx.query(
        'SELECT revision,identity_status FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0]
    const decisions = (
      await tx.query(
        'SELECT id,payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision',
        [current.organization_id, current.id],
      )
    ).rows
    const docs = (
      await tx.query(
        'SELECT id,current_document_id FROM aic.mvp_document_lineages WHERE organization_id=$1 AND case_id=$2 ORDER BY id',
        [current.organization_id, current.id],
      )
    ).rows
    return requestHash({
      counterparty: cp,
      exposure: current.exposure_json,
      docs,
      decisions,
      facts: facts.map((f) => ({
        id: f.id,
        revision: Number(f.revision),
        payload: f.payload_json,
      })),
    })
  }
  private async setTx(tx: SqlClient, current: any, row: any) {
    const facts = (
      await tx.query(
        'SELECT * FROM aic.mvp_financial_facts WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY fact_key',
        [current.organization_id, current.id, row.id, row.revision],
      )
    ).rows
    const hash = await this.snapshot(tx, current, facts)
    const decisions = (
      await tx.query(
        'SELECT * FROM aic.mvp_financial_verifications WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY case_revision',
        [current.organization_id, current.id, row.id, row.revision],
      )
    ).rows
    let stale = false
    const output = []
    for (const fact of facts) {
      const decision = decisions.filter((d) => d.fact_ids.includes(fact.id)).at(-1),
        currentSource = await this.source(tx, current, fact.payload_json.source, false)
      const isStale = !!decision && (decision.source_snapshot_hash !== hash || !currentSource)
      stale ||= isStale
      output.push({
        ...fact.payload_json,
        id: fact.id,
        revision: Number(fact.revision),
        current_source: currentSource,
        verification: {
          status: !decision ? 'unverified' : isStale ? 'stale' : decision.status,
          verified_revision: decision ? Number(fact.revision) : null,
          verified_by: decision?.actor_id ?? null,
          verified_at: decision ? iso(decision.created_at) : null,
        },
        ...(decision ? { verification_reason: decision.reason } : {}),
      })
    }
    return {
      read: this.output('FinancialSetRead', {
        id: row.id,
        revision: Number(row.revision),
        scope: row.scope_json,
        metadata: row.metadata_json,
        facts: output,
        created_at: iso(row.created_at),
        verification_stale: stale,
      }),
      decisions,
      hash,
    }
  }
  async get(session: AuthSession, caseId: string, setId?: string) {
    requireUuid(caseId)
    if (setId !== undefined) requireUuid(setId)
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId)
      return this.detailTx(tx, current, setId)
    })
  }
  async detailTx(tx: SqlClient, current: any, setId?: string) {
    const rows = (
      await tx.query(
        'SELECT DISTINCT ON(id) * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC',
        [current.organization_id, current.id],
      )
    ).rows
    const sets = []
    const prepared = []
    for (const row of rows) {
      const value = await this.setTx(tx, current, row)
      sets.push(value.read)
      prepared.push(value)
    }
    const blockers = ['FHI_METHOD_UNCONFIGURED']
    let metrics: any[] = []
    const selected =
      setId === undefined ? (sets.length === 1 ? 0 : -1) : sets.findIndex((s) => s.id === setId)
    if (setId !== undefined && selected === -1) throw notFound()
    if (selected !== -1) {
      const set = sets[selected],
        facts: FhiFinancialFact[] = set.facts.map((f: any) => ({
          id: f.id,
          revision: f.revision,
          key: f.key,
          statement_set_id: set.id,
          statement_set_revision: set.revision,
          scope: { ...set.scope, unit_multiplier: '1' },
          value: f.normalized_decimal,
          verification: f.verification,
          current_source: f.current_source,
          source_refs: [
            f.source.kind === 'document'
              ? {
                  kind: 'document',
                  document_id: f.source.document_id,
                  document_version: f.source.document_version,
                  source_hash: f.source.source_hash,
                  page: f.source.page,
                  quote: f.source.quote,
                }
              : { kind: 'verified_entry', entry_id: f.id, entry_revision: f.revision },
          ],
        }))
      const latest = prepared[selected].decisions.at(-1)
      const verifiedBridge = (keys: string[], kind: 'quick_assets' | 'ebitda') => {
        if (
          !latest ||
          latest.status !== 'verified' ||
          latest.source_snapshot_hash !== prepared[selected].hash ||
          !keys.every((k) =>
            set.facts.some(
              (f: any) =>
                f.key === k &&
                f.verification.status === 'verified' &&
                latest.fact_ids.includes(f.id),
            ),
          )
        )
          return null
        const components = facts.filter((f) => keys.includes(f.key))
        return {
          id: latest.id,
          revision: Number(latest.case_revision),
          statement_set_id: set.id,
          statement_set_revision: set.revision,
          verification: {
            status: 'verified' as const,
            verified_revision: Number(latest.case_revision),
            verified_by: latest.actor_id,
            verified_at: iso(latest.created_at),
          },
          current_source: true,
          source_refs: components.flatMap((f) => f.source_refs),
          components: components.map((f) => ({
            key: f.key,
            fact_id: f.id,
            fact_revision: f.revision,
          })),
          non_overlapping:
            kind === 'quick_assets' ? latest.bridge_assertions.quick_assets_non_overlapping : true,
        }
      }
      const quick = verifiedBridge(
          ['cash', 'unrestricted_short_term_equivalents', 'trade_receivables'],
          'quick_assets',
        ),
        ebitda = verifiedBridge(['operating_profit', 'depreciation_amortization'], 'ebitda')
      const input: FhiInput = {
        statement_set: {
          id: set.id,
          revision: set.revision,
          scope: { ...set.scope, unit_multiplier: '1' },
        },
        facts,
        quick_assets_bridge: quick
          ? {
              ...quick,
              kind: 'quick_assets',
              acceptable_per_source: latest.bridge_assertions.quick_assets_eligible,
            }
          : null,
        ebitda_bridge: ebitda
          ? {
              ...ebitda,
              kind: 'ebitda',
              da_is_addback_to_ebit: latest.bridge_assertions.da_addback_to_operating_profit,
            }
          : null,
      }
      const engine = scoreFhi(input)
      if (set.metadata.observation_kind !== 'actual' || set.scope.accounting_regime === 'UNKNOWN')
        blockers.push('ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED')
      metrics = engine.metrics.map((m) => ({
        metric_id: m.metric_id,
        group: m.group,
        formula_id: m.formula_id,
        formula: m.formula,
        status: m.status,
        raw_ratio: m.raw_ratio,
        source_facts: m.source_facts,
        max_points: m.max_points,
        anchors: FHI_METRICS.find((d) => d.id === m.metric_id)!.anchors,
        points: null,
        flags: m.flags,
        blockers: m.blockers,
      }))
      blockers.push(...engine.blockers.map((b) => b.code))
    } else
      blockers.push(
        sets.length ? 'EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED' : 'FINANCIAL_INPUTS_REQUIRED',
      )
    return this.output('FinancialRegistry', {
      sets,
      selected_set_id: selected === -1 ? null : sets[selected].id,
      method_status: 'unconfigured',
      score: null,
      band: null,
      grade: null,
      pd: null,
      metrics,
      blockers: [...new Set(blockers)],
      strengths: [],
      weaknesses: [],
      limitations: [
        'AIC experimental method is not approved; no score or band is published.',
        'Verified entry/source fidelity does not confirm legal identity.',
        'No FX, annualization, profit proxy or weight redistribution.',
        'Balance sheet tolerance awaits approval; only exact reconciliation is accepted by this implementation.',
      ],
    })
  }
  private async resource(session: AuthSession, id: string) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          'SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1',
          [session.user.organization_id, id],
        )
      ).rows[0]
      if (!row) throw notFound()
      await this.access(tx, session, row.case_id)
      return row
    })
  }
  async save(
    session: AuthSession,
    caseId: string,
    id: string | undefined,
    key: string,
    body: unknown,
  ) {
    const input = this.input('FinancialSetInput', body)
    if (input.period.start_date > input.period.end_date) fail('INVALID_FINANCIAL_PERIOD')
    if (new Set(input.facts.map((f: any) => f.key)).size !== input.facts.length)
      fail('DUPLICATE_FINANCIAL_FACT')
    return this.mutations.execute(session, caseId, {
      operation: id ? 'financial.revise:' + id : 'financial.create',
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (!['RECEIVABLE', 'PREPAYMENT'].includes(current.exposure_kind))
          fail('UNSUPPORTED_EXPOSURE')
        const prior = id
          ? (
              await tx.query(
                'SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1',
                [current.organization_id, current.id, id],
              )
            ).rows[0]
          : null
        if (id && !prior) throw notFound()
        const setId = id ?? randomUUID(),
          revision = prior ? Number(prior.revision) + 1 : 1
        if (!Number.isSafeInteger(revision)) fail('REVISION_CONFLICT', 409)
        const cp = (
          await tx.query(
            'SELECT country,industry_code FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0]
        const scope: FhiScope = {
          entity_id: current.counterparty_id,
          country: cp.country,
          industry: cp.industry_code ?? 'UNKNOWN',
          pilot_scope: input.industry_scope,
          period: input.period,
          basis: input.basis,
          accounting_regime: input.accounting_regime,
          currency: input.currency,
          unit_multiplier: input.unit_multiplier,
        }
        await tx.query(
          `INSERT INTO aic.mvp_financial_sets(id,revision,organization_id,case_id,scope_json,metadata_json,bridges_json,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'{}'::jsonb,$7,$8,$9)`,
          [
            setId,
            revision,
            current.organization_id,
            current.id,
            canonicalJson(scope),
            canonicalJson({
              audit_status: input.audit_status,
              statement_version: input.statement_version,
              observation_kind: input.observation_kind,
            }),
            next,
            session.user.id,
            input.reason,
          ],
        )
        const old = prior
          ? (
              await tx.query(
                'SELECT * FROM aic.mvp_financial_facts WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4',
                [current.organization_id, current.id, setId, prior.revision],
              )
            ).rows
          : []
        for (const fact of input.facts) {
          if (fact.raw_value === null ? !fact.missing_reason?.trim() : fact.missing_reason !== null)
            fail('FINANCIAL_MISSING_REASON_REQUIRED')
          if (!(await this.source(tx, current, fact.source, false)))
            fail('INVALID_FINANCIAL_SOURCE')
          const id = old.find((f) => f.fact_key === fact.key)?.id ?? randomUUID()
          const normalized =
            fact.raw_value === null
              ? null
              : Decimal.parse(fact.raw_value).mul(Decimal.parse(input.unit_multiplier)).toString()
          const payload = {
            ...fact,
            normalized_decimal: normalized,
            currency: input.currency,
            unit_multiplier: input.unit_multiplier,
            period: input.period,
            basis: input.basis,
            adjustments:
              fact.raw_value === null
                ? []
                : [
                    {
                      kind: 'unit_normalization',
                      multiplier: input.unit_multiplier,
                      result: normalized,
                    },
                  ],
            source_origin: fact.source.kind === 'manual_entry' ? 'staff_entered' : 'document',
            entered_by: session.user.id,
            recorded_case_revision: next,
          }
          await tx.query(
            'INSERT INTO aic.mvp_financial_facts(id,revision,organization_id,case_id,set_id,set_revision,fact_key,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
            [
              id,
              revision,
              current.organization_id,
              current.id,
              setId,
              revision,
              fact.key,
              canonicalJson(payload),
            ],
          )
          if (fact.source.kind === 'document')
            await tx.query(
              'INSERT INTO aic.mvp_financial_source_bindings(organization_id,case_id,fact_id,fact_revision,document_id,document_version,document_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                current.organization_id,
                current.id,
                id,
                revision,
                fact.source.document_id,
                fact.source.document_version,
                fact.source.source_hash,
              ],
            )
        }
        const row = (
          await tx.query('SELECT * FROM aic.mvp_financial_sets WHERE id=$1 AND revision=$2', [
            setId,
            revision,
          ])
        ).rows[0]
        return {
          status: id ? 200 : 201,
          body: this.output('FinancialMutationOutput', {
            set: (await this.setTx(tx, current, row)).read,
            revision: next,
          }),
          action: id ? 'financial.revised' : 'financial.created',
          reason: input.reason,
          subjectId: setId,
        }
      },
    })
  }
  async revise(session: AuthSession, id: string, key: string, body: unknown) {
    const row = await this.resource(session, id)
    return this.save(session, row.case_id, id, key, body)
  }
  async verify(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('FinancialVerifyInput', body),
      bound = await this.resource(session, id)
    return this.mutations.execute(session, bound.case_id, {
      operation: 'financial.verify:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const row = (
          await tx.query(
            'SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1',
            [current.organization_id, current.id, id],
          )
        ).rows[0]
        if (Number(row.revision) !== input.set_revision) fail('STALE_FINANCIAL_SET', 409)
        const prepared = await this.setTx(tx, current, row)
        if (input.fact_ids.some((id: string) => !prepared.read.facts.some((f: any) => f.id === id)))
          fail('INVALID_FINANCIAL_FACT')
        for (const f of prepared.read.facts.filter((f: any) => input.fact_ids.includes(f.id))) {
          if (
            input.status === 'verified' &&
            (f.normalized_decimal === null || !(await this.source(tx, current, f.source, true)))
          )
            fail('FINANCIAL_SOURCE_REVIEW_REQUIRED')
        }
        await tx.query(
          `INSERT INTO aic.mvp_financial_verifications(id,organization_id,case_id,set_id,set_revision,fact_ids,status,bridge_assertions,source_snapshot_hash,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            id,
            row.revision,
            canonicalJson(input.fact_ids),
            input.status,
            canonicalJson(input.bridge_assertions),
            prepared.hash,
            next,
            session.user.id,
            input.reason,
          ],
        )
        return {
          status: 200,
          body: this.output('FinancialMutationOutput', {
            set: (await this.setTx(tx, current, row)).read,
            revision: next,
          }),
          action: 'financial.verified',
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
}
