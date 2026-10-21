import { randomUUID } from 'crypto'
import db from '../db/sqlite'
import { seqBucket, DOC_NUMBER_TABLES } from './docSeq'

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

const MAX_COLLISION_SKIPS = 1000
const numberColCache = new Map<string, string | null>()

/** เลขนี้มีอยู่แล้วในตารางของ docType นั้นไหม (docType ที่ไม่มีตารางใน DOC_NUMBER_TABLES = ไม่เช็ค) */
function docNumberExists(tenantId: string, docType: string, num: string): boolean {
  const table = DOC_NUMBER_TABLES.find(([t]) => t === docType)?.[1]
  if (!table) return false
  let col = numberColCache.get(table)
  if (col === undefined) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    col = cols.some(c => c.name === 'tenant_id') ? cols.find(c => c.name.endsWith('_number'))?.name ?? null : null
    numberColCache.set(table, col)
  }
  if (!col) return false
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE tenant_id = ? AND ${col} = ? LIMIT 1`).get(tenantId, num)
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
  const fmtHasYear = !!(fmt && fmt.date_format && fmt.date_format !== 'NONE')
  const bucket = fmt ? (fmtHasYear ? seqBucket(fmt.reset_period, fmt.date_format, d) : 0) : segment !== undefined ? Number(segment) : 0

  if (fmt) {
    const p = fmt.prefix || prefix
    const sep = fmt.separator ?? '-'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    let dateStr = ''
    if (fmt.date_format === 'DDMMYY') dateStr = dd + mm + yy
    else if (fmt.date_format === 'YYMMDD') dateStr = yy + mm + dd
    else if (fmt.date_format === 'MMYY') dateStr = mm + yy
    else if (fmt.date_format === 'YYYY') dateStr = String(d.getFullYear())
    const build = (seq: number) => {
      const num = String(seq).padStart(fmt.padding || pad, '0')
      return dateStr ? `${p}${sep}${num}${sep}${dateStr}` : `${p}${sep}${num}`
    }
    // ผู้ใช้เปลี่ยนรูปแบบ/รอบรีเซ็ตกลางทาง → ถังนับใหม่เริ่ม 1 อาจได้เลขเดียวกับเอกสารที่ออกไปแล้ว: ข้ามเลขที่มีอยู่
    for (let i = 0; i < MAX_COLLISION_SKIPS; i++) {
      const candidate = build(getNextDocumentNumber(tenantId, docType, bucket))
      if (!docNumberExists(tenantId, docType, candidate)) return candidate
    }
    throw new Error(`ออกเลขเอกสาร ${docType} ไม่สำเร็จ: เลขซ้ำกับของเดิมต่อเนื่องเกิน ${MAX_COLLISION_SKIPS} ครั้ง`)
  }

  const seq = getNextDocumentNumber(tenantId, docType, bucket)
  const middle = segment !== undefined ? `-${segment}-` : '-'
  return `${prefix}${middle}${String(seq).padStart(pad, '0')}`
}

// เซิร์ฟเวอร์รัน UTC — ต้องแปลงเป็นนาฬิกาไทยก่อนดึงวัน/เดือน/ปีไปทำเลขเอกสาร
// ไม่งั้นเอกสารที่ออกช่วง 00:00–06:59 น. ได้วันที่ (DDMMYY) และถังปีของ "เมื่อวาน"
const thaiWallClock = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))

/** คืน Date ที่ฟิลด์ local = วัน/เวลาตามนาฬิกาไทย ·
 *  'YYYY-MM-DD' หรือวันเวลาที่ไม่มีโซน = เป็นวันที่ตามนาฬิกาอยู่แล้ว ไม่แปลง ·
 *  timestamp ที่มีโซน (…Z / +07:00) หรือ Date → แปลงเป็นเวลาไทย · ว่าง/ผิดรูป → ตอนนี้ (เวลาไทย) */
function parseDocDate(v?: string | Date | null): Date {
  if (!v) return thaiWallClock(new Date())
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00`)
  const d = new Date(v)
  if (isNaN(d.getTime())) return thaiWallClock(new Date())
  const hasZone = v instanceof Date || /(Z|[+-]\d{2}:?\d{2})$/.test(v)
  return hasZone ? thaiWallClock(d) : d
}

/** ปี ค.ศ. ของวันที่เอกสาร — ใช้เป็น segment ของเลขแบบไม่ได้ตั้งรูปแบบ (PO-2026-00001) */
export function docYear(v?: string | Date | null): number {
  return parseDocDate(v).getFullYear()
}

/** วันที่ตามนาฬิกาไทยเป็น 'YYYY-MM-DD' — timestamp ที่มีโซน (…Z) แปลงเป็นเวลาไทยก่อน · ว่าง = วันนี้ (ไทย) */
export function thaiDateStr(v?: string | Date | null): string {
  const d = parseDocDate(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
