import type { SqlClient } from '../foundation/ports'
import { notFound, FoundationError } from '../foundation/errors'
import { createHash } from 'node:crypto'

export const IMPORT_VERSION = 'AIC-FINANCIAL-IMPORT-1'
export const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export function countryCode(value: string): string {
  const code = String(value).normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase()
  return ({ VN: 'VN', VIETNAM: 'VN', 'VIET NAM': 'VN', US: 'US', USA: 'US',
    'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', CN: 'CN', CHINA: 'CN',
    'TRUNG QUOC': 'CN', '中国': 'CN', 'HOA KY': 'US', 'MY': 'US' } as Record<string,string>)[code] || code
}
export async function importSource(tx: SqlClient, current: any, kind: string, id: string, withBytes = false) {
  const args = [current.organization_id, current.id, id]
  let row: any
  if (kind === 'document') row = (await tx.query(`SELECT d.id,d.hash AS sha256,d.version AS document_version,
    d.name,d.pages AS page_count${withBytes ? ',o.bytes' : ''}
    FROM aic.mvp_documents d JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id
    AND l.case_id=d.case_id AND l.id=d.lineage AND l.current_document_id=d.id
    ${withBytes ? 'JOIN aic.mvp_document_objects o ON o.organization_id=d.organization_id AND o.case_id=d.case_id AND o.document_id=d.id' : ''}
    WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3`, args)).rows[0]
  else if (kind === 'dossier_member') row = (await tx.query(`SELECT m.id,m.sha256,m.entry_path AS name,
    m.page_count${withBytes ? ',o.bytes' : ''} FROM aic.mvp_dossier_members m
    JOIN aic.mvp_dossier_member_objects o ON o.organization_id=m.organization_id AND o.case_id=m.case_id AND o.member_id=m.id
    WHERE m.organization_id=$1 AND m.case_id=$2 AND m.id=$3 AND m.detected_mime='application/pdf'`, args)).rows[0]
  else if (kind === 'financial_file') row = (await tx.query(`SELECT id,sha256,name,page_count${withBytes ? ',bytes' : ''}
    FROM aic.financial_import_sources WHERE organization_id=$1 AND case_id=$2 AND id=$3`, args)).rows[0]
  if (!row) throw notFound()
  if (withBytes && (!Buffer.isBuffer(row.bytes) || row.bytes.length > 25_000_000 || sha(row.bytes) !== row.sha256))
    throw new FoundationError(500, 'SOURCE_INTEGRITY_FAILURE')
  return { ...row, kind }
}
export async function importReceipt(tx: SqlClient, current: any, id: string) {
  const row = (await tx.query(`SELECT metadata_json FROM aic.audit_events
    WHERE organization_id=$1 AND case_id=$2 AND subject_id=$3 AND action IN ('financial.import_extracted','financial.intake_period_reviewed','financial.reasoning_reviewed')`,
    [current.organization_id, current.id, id])).rows[0]?.metadata_json
  if (!row || row.contract_version !== IMPORT_VERSION) throw notFound()
  return row
}
export async function validImportedSource(tx: SqlClient, current: any, source: any, reviewed: boolean) {
  try {
    const receipt = await importReceipt(tx, current, source.receipt_id)
    const file = await importSource(tx, current, source.source_kind, source.source_id)
    if (receipt.document_type !== 'financial_statement' || !(await currentFinancialFile(tx,current,file.id)) || file.sha256 !== source.source_hash || receipt.source.id !== file.id || receipt.source.kind !== file.kind ||
        receipt.sha256 !== source.source_hash || !receipt.facts.some((f: any) => f.key === source.fact_key &&
          f.page === source.page && f.quote === source.quote)) return false
    if (!reviewed) return true
    const cp = (await tx.query('SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
      [current.organization_id, current.counterparty_id])).rows[0]
    return !!(await tx.query(`SELECT 1 FROM aic.audit_events WHERE organization_id=$1 AND case_id=$2
      AND subject_id=$3 AND action='financial.import_reviewed' AND metadata_json->>'counterparty_revision'=$4`,
      [current.organization_id, current.id, source.receipt_id, String(cp.revision)])).rows[0]
  } catch (error) {
    if (error instanceof FoundationError && error.getStatus() === 404) return false
    throw error
  }
}
export async function currentFinancialFile(tx: SqlClient, current: any, sourceId: string) {
  const rows = (await tx.query(`SELECT superseded_by,origin_json FROM aic.financial_intakes
    WHERE organization_id=$1 AND case_id=$2 AND prepared_source_id=$3`,
    [current.organization_id,current.id,sourceId])).rows;
  return !rows.length || rows.some(r=>!r.superseded_by && !r.origin_json?.exclusion);
}
