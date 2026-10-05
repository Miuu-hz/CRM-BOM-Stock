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
 * @param docDate วันที่ของตัวเอกสารเอง (เช่นวันที่บนบิลที่ป้อนย้อนหลัง) — ใช้ทำส่วนวันที่และเลือกถังปี
 *   ของเลขรันตามรูปแบบใน Settings ไม่ส่งมา = วันนี้ (พฤติกรรมเดิม) เดิมใช้ new Date() เสมอ บิลย้อนหลัง
 *   ที่ป้อนผ่าน MCP จึงได้วันที่ "วันนี้" ในเลขเอกสารแทนวันที่บนบิล
 */
export function formatDocumentNumber(
  prefix: string,
  tenantId: string,
  docType: string,
  segment?: number | string,
  pad = 5,
  docDate?: string | Date | null
): string {
  // Custom format override (Settings → เลขที่เอกสาร): {PREFIX}{sep}{SEQ}{sep}{DATE}
  let fmt: any
  try {
    fmt = db.prepare(
      'SELECT * FROM document_number_formats WHERE tenant_id = ? AND doc_type = ? AND enabled = 1'
    ).get(tenantId, docType)
  } catch { /* table not migrated yet */ }

  const d = parseDocDate(docDate)
  const currentYear = d.getFullYear()
  const fmtHasYear = !!(fmt && fmt.date_format && fmt.date_format !== 'NONE')
  const seq = getNextDocumentNumber(
    tenantId,
    docType,
    fmt ? (fmtHasYear ? currentYear : 0) : segment !== undefined ? Number(segment) : 0
  )

  if (fmt) {
    const p = fmt.prefix || prefix
    const num = String(seq).padStart(fmt.padding || pad, '0')
    const sep = fmt.separator ?? '-'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    let dateStr = ''
    if (fmt.date_format === 'DDMMYY') dateStr = dd + mm + yy
    else if (fmt.date_format === 'YYMMDD') dateStr = yy + mm + dd
    else if (fmt.date_format === 'MMYY') dateStr = mm + yy
    else if (fmt.date_format === 'YYYY') dateStr = String(d.getFullYear())
    return dateStr ? `${p}${sep}${num}${sep}${dateStr}` : `${p}${sep}${num}`
  }

  const middle = segment !== undefined ? `-${segment}-` : '-'
  return `${prefix}${middle}${String(seq).padStart(pad, '0')}`
}

/** 'YYYY-MM-DD' ล้วน → เที่ยงคืนเวลาท้องถิ่น (new Date('YYYY-MM-DD') = UTC ทำให้วันเลื่อนในโซนติดลบ) · ว่าง/ผิดรูป → วันนี้ */
function parseDocDate(v?: string | Date | null): Date {
  if (!v) return new Date()
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v)
  return isNaN(d.getTime()) ? new Date() : d
}

/** ปี ค.ศ. ของวันที่เอกสาร — ใช้เป็น segment ของเลขแบบไม่ได้ตั้งรูปแบบ (PO-2026-00001) */
export function docYear(v?: string | Date | null): number {
  return parseDocDate(v).getFullYear()
}
