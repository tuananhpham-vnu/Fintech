import { createHash } from 'node:crypto'

/** Use the same canonical SQL for execution, ledger writes, and readiness checks. */
export function canonicalMigrationSource(contents: string): { sql: string; checksum: string } {
  const sql = contents.replace(/\r\n/g, '\n')
  return { sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') }
}
