import { randomBytes } from 'crypto'
import QRCode from 'qrcode'
import db from '../db/sqlite'

export type ReceiptDocType = 'pos_bill' | 'invoice'

const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'

/**
 * Get the existing public share token for a document, or mint a new unguessable one.
 * Token is 192 bits of crypto-random data (base64url) — not derived from the doc id,
 * not sequential, and stored as the primary key of receipt_tokens (O(1) lookup, no
 * enumeration surface). One token per (tenant, doc_type, doc_id): reprints/reloads
 * reuse the same link instead of minting a fresh one every time.
 */
export function getOrCreateReceiptToken(docType: ReceiptDocType, docId: string, tenantId: string): string {
  const existing = db.prepare(
    'SELECT token FROM receipt_tokens WHERE tenant_id = ? AND doc_type = ? AND doc_id = ?'
  ).get(tenantId, docType, docId) as { token: string } | undefined
  if (existing) return existing.token

  const token = randomBytes(24).toString('base64url')
  try {
    db.prepare(
      'INSERT INTO receipt_tokens (token, tenant_id, doc_type, doc_id) VALUES (?, ?, ?, ?)'
    ).run(token, tenantId, docType, docId)
    return token
  } catch {
    // ponytail: lost a race with a concurrent request minting the same doc's token
    // (unique index on tenant_id/doc_type/doc_id) — reuse theirs instead of erroring.
    const row = db.prepare(
      'SELECT token FROM receipt_tokens WHERE tenant_id = ? AND doc_type = ? AND doc_id = ?'
    ).get(tenantId, docType, docId) as { token: string }
    return row.token
  }
}

export function buildReceiptUrl(token: string): string {
  return `${APP_URL}/r/${token}`
}

export async function buildReceiptQr(token: string): Promise<string> {
  return QRCode.toDataURL(buildReceiptUrl(token), { margin: 1, width: 240 })
}
