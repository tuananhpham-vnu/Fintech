import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { CaseMutations } from '../foundation/case-mutations'
import { canonicalJson, requestHash } from '../foundation/canonical'
import { FoundationError } from '../foundation/errors'
import { validateContract } from '../foundation/validation'
import { FOUNDATION_DB } from '../foundation/ports'
import type { AuthSession, FoundationDatabase } from '../foundation/ports'
import { DOCUMENT_REPOSITORY } from './ports'
import type { DocumentRepository, StoredDocument } from './ports'
import { projectLegacyExtraction } from './evidence-projection'

@Injectable()
export class DocumentDecisions {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    private readonly mutations: CaseMutations,
  ) {}
  async decide(
    session: AuthSession,
    id: string,
    kind: 'classification' | 'correction' | 'verification',
    key: string,
    body: unknown,
  ) {
    const input: any = JSON.parse(canonicalJson(body))
    validateContract(
      kind === 'classification'
        ? 'DocumentClassificationInput'
        : kind === 'verification'
          ? 'DocumentFieldVerificationInput'
          : 'DocumentCorrectionInput',
      input,
    )
    const { document } = await this.documents.read(session, id)
    return this.mutations.execute(session, document.case_id, {
      operation: 'document.' + kind + ':' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const policy = (
          await tx.query(
            'SELECT artifact_json FROM aic.mvp_policy_artifacts WHERE version=$1 AND sha256=$2',
            [current.policy_version, current.policy_artifact_hash],
          )
        ).rows[0]?.artifact_json
        if (
          !policy ||
          policy.status !== 'approved' ||
          requestHash(policy) !== current.policy_artifact_hash ||
          !policy.scope?.exposure_kinds?.includes(current.exposure_kind)
        )
          throw new FoundationError(409, 'POLICY_BINDING_REQUIRED')
        const active = (
          await tx.query(
            'SELECT current_document_id FROM aic.mvp_document_lineages WHERE organization_id=$1 AND case_id=$2 AND id=$3',
            [current.organization_id, current.id, document.lineage],
          )
        ).rows[0]
        if (active?.current_document_id !== id)
          throw new FoundationError(409, 'DOCUMENT_SUPERSEDED')
        const raw: any = document.extraction
        const counterparty = (
          await tx.query(
            'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0]
        const projection = raw ? projectLegacyExtraction(document, raw) : null
        if (
          kind === 'classification' &&
          input.reviewed_pages.some((page: number) => page > document.pages)
        )
          throw new FoundationError(422, 'INVALID_SOURCE_PAGE')
        if (
          input.evidence_refs.some((ref: string) => !projection?.evidence.some((e) => e.id === ref))
        )
          throw new FoundationError(422, 'INVALID_DOCUMENT_EVIDENCE')
        if (
          kind === 'correction' &&
          (!projection?.fields.some((f) => f.field_key === input.field_key) ||
            (input.value !== null && !input.evidence_refs.length))
        )
          throw new FoundationError(422, 'INVALID_FIELD_CORRECTION')
        if (kind === 'verification') {
          const field = projection?.fields.find((f) => f.field_key === input.field_key)
          const history = (
            await tx.query(
              'SELECT kind,payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 ORDER BY case_revision',
              [current.organization_id, current.id, id],
            )
          ).rows
          for (const change of history.filter(
            (h) => h.kind === 'correction' && h.payload_json.field_key === input.field_key,
          ))
            if (field) field.value = change.payload_json.value
          const classification = history
            .filter((h) => h.kind === 'classification')
            .at(-1)?.payload_json
          if (
            !field ||
            field.value === null ||
            classification?.subject_match !== 'match' ||
            Number(classification.counterparty_revision) !== Number(counterparty.revision) ||
            input.evidence_refs.some(
              (ref: string) =>
                !projection.evidence.some(
                  (e) => e.id === ref && classification.reviewed_pages.includes(e.page),
                ),
            )
          )
            throw new FoundationError(422, 'FIELD_SOURCE_REVIEW_REQUIRED')
        }
        // Classification is a specialist's bounded source review. It does not
        // change the counterparty's identity status or certify a payment/contract.
        const payload = {
          ...input,
          verification: kind !== 'classification' ? 'human_reviewed' : 'source_reviewed',
          entered_by: session.user.id,
          document_id: id,
          document_version: document.version,
          source_hash: document.hash,
          counterparty_revision: Number(counterparty.revision),
        }
        delete payload.expected_revision
        const saved = (
          await tx.query(
            `INSERT INTO aic.mvp_document_decisions(id,organization_id,case_id,document_id,document_version,document_sha256,case_revision,kind,payload_json,reason,actor_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING created_at`,
            [
              randomUUID(),
              current.organization_id,
              current.id,
              id,
              document.version,
              document.hash,
              next,
              kind,
              canonicalJson(payload),
              input.reason,
              session.user.id,
            ],
          )
        ).rows[0]
        return {
          status: 200,
          body: {
            document_id: id,
            revision: next,
            decision: payload,
            created_at: new Date(saved.created_at).toISOString(),
          },
          action: 'document.' + kind + '.reviewed',
          reason: input.reason,
          subjectId: id,
          metadata: { document_version: document.version, source_hash: document.hash },
        }
      },
    })
  }
  async projection(session: AuthSession, document: StoredDocument) {
    // Revalidate access at the read boundary rather than trusting a supplied row.
    const exact = await this.documents.read(session, document.id)
    const projected = exact.document.extraction
      ? projectLegacyExtraction(exact.document, exact.document.extraction as any)
      : null
    if (!projected) return null
    const rows = (
      await this.db.query(
        `SELECT kind,payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3
      AND document_version=$4 AND document_sha256=$5 ORDER BY case_revision`,
        [
          session.user.organization_id,
          document.case_id,
          document.id,
          document.version,
          document.hash,
        ],
      )
    ).rows
    const cp = (
      await this.db.query(
        'SELECT p.revision FROM aic.counterparties p JOIN aic.cases c ON c.organization_id=p.organization_id AND c.counterparty_id=p.id WHERE c.organization_id=$1 AND c.id=$2',
        [session.user.organization_id, document.case_id],
      )
    ).rows[0]
    for (const row of rows)
      if (row.kind === 'correction' || row.kind === 'verification') {
        const field = projected.fields.find((f) => f.field_key === row.payload_json.field_key)
        if (field) {
          if (row.kind === 'correction') field.value = row.payload_json.value
          field.evidence_refs = row.payload_json.evidence_refs
          field.quality =
            Number(row.payload_json.counterparty_revision) === Number(cp?.revision)
              ? 'human_reviewed'
              : 'uncertain'
          field.missing_reason = field.value === null ? 'human_marked_missing' : null
        }
      }
    return projected
  }
}
