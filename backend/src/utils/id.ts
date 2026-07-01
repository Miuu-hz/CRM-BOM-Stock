import { randomUUID } from 'crypto'
import db from '../db/sqlite'

export const generateId = (): string =>
  randomUUID().replace(/-/g, '').substring(0, 25)

/**
 * Atomically reserve the next sequential document number for a tenant/doc-type/year.
 * ponytail: uses a single-row counter with SQLite transaction isolation; safe for
 * concurrent requests because the SELECT + UPSERT happens inside one transaction.
 */
export function getNextDocumentNumber(
  tenantId: string,
  docType: string,
  year = 0
): number {
  return db.transaction(() => {
    const row = db
      .prepare(
        'SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = ? AND year = ?'
      )
      .get(tenantId, docType, year) as { last_number: number } | undefined

    const next = (row?.last_number || 0) + 1

    db.prepare(
      `INSERT INTO document_sequences (tenant_id, doc_type, year, last_number)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, doc_type, year) DO UPDATE SET last_number = ?`
    ).run(tenantId, docType, year, next, next)

    return next
  })()
}

/**
 * Format an atomically-reserved document number.
 * @param segment optional middle segment (e.g. year or YYYYMMDD). Omit for no segment.
 */
export function formatDocumentNumber(
  prefix: string,
  tenantId: string,
  docType: string,
  segment?: number | string,
  pad = 5
): string {
  const seq = getNextDocumentNumber(
    tenantId,
    docType,
    segment !== undefined ? Number(segment) : 0
  )
  const middle = segment !== undefined ? `-${segment}-` : '-'
  return `${prefix}${middle}${String(seq).padStart(pad, '0')}`
}
