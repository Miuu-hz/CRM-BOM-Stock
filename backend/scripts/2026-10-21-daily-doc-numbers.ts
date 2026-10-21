/**
 * สคริปต์ปรับรูปแบบเลขที่เอกสารทุกประเภทเป็น PREFIX-ลำดับ-DDMMYY รีเซ็ตทุกวัน (DAY)
 * สำหรับรันครั้งเดียวตอน deploy
 *
 * การใช้งาน:
 *   npx tsx scripts/2026-10-21-daily-doc-numbers.ts --tenant <tenant_id>          # dry-run ดูอย่างเดียว
 *   npx tsx scripts/2026-10-21-daily-doc-numbers.ts --tenant <tenant_id> --apply  # บันทึกจริงลง DB
 *
 * ใช้ SQLITE_DB_PATH ตาม backend/src/db/connection.ts
 * ห้ามรันกับ DB จริงตรงๆ — ผู้ดูแลจะรันเองตอน deploy
 */
import db from '../src/db/sqlite'

// รายการ DOC_TYPES อ้างอิงจาก frontend/src/pages/settings/DocumentNumberSettings.tsx
export const DOC_TYPES: { value: string; label: string; defaultPrefix: string }[] = [
  { value: 'PURCHASE_REQUEST', label: 'ใบขอซื้อ (PR)',        defaultPrefix: 'PR' },
  { value: 'PO',               label: 'ใบสั่งซื้อ (PO)',       defaultPrefix: 'PO' },
  { value: 'GOODS_RECEIPT',    label: 'ใบรับของ (GR)',        defaultPrefix: 'GR' },
  { value: 'PURCHASE_INVOICE', label: 'ใบแจ้งหนี้ซื้อ (PI)',   defaultPrefix: 'PI' },
  { value: 'SUPPLIER_PAYMENT', label: 'ใบจ่ายเงิน (PAY)',     defaultPrefix: 'PAY' },
  { value: 'QUOTATION',        label: 'ใบเสนอราคา (QT)',      defaultPrefix: 'QT' },
  { value: 'SALES_ORDER',      label: 'ออเดอร์ขาย (SO)',      defaultPrefix: 'SO' },
  { value: 'DELIVERY_ORDER',   label: 'ใบส่งของ (DO)',        defaultPrefix: 'DO' },
  { value: 'INVOICE',          label: 'ใบแจ้งหนี้ขาย (INV)',   defaultPrefix: 'INV' },
  { value: 'RECEIPT',          label: 'ใบเสร็จ (RC)',          defaultPrefix: 'RC' },
  { value: 'CREDIT_NOTE',      label: 'ใบลดหนี้ (CN)',        defaultPrefix: 'CN' },
  { value: 'POS_BILL',         label: 'บิล POS',              defaultPrefix: 'POS' },
  { value: 'POS_SHIFT',        label: 'กะขาย POS',           defaultPrefix: 'SHIFT' },
  { value: 'WORK_ORDER',       label: 'ใบสั่งผลิต (WO)',      defaultPrefix: 'WO' },
  { value: 'JOURNAL',          label: 'สมุดรายวัน (JV)',      defaultPrefix: 'JV' },
  { value: 'STOCK_ADJUSTMENT', label: 'ใบปรับสต็อก (ADJ)',    defaultPrefix: 'ADJ' },
]

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
const tenant = valuesOf('--tenant')[0]

// ความกว้างที่ตาเห็น — สระบน/ล่างและวรรณยุกต์ไทยไม่กินช่อง
const width = (s: string) => [...s].filter(ch => !/[ัิ-ฺ็-๎]/.test(ch)).length
const padEndVisual = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))

export function runDailyDocNumbers(tenantId: string, isApply: boolean) {
  const existingRows = db.prepare('SELECT * FROM document_number_formats WHERE tenant_id = ?').all(tenantId) as any[]

  interface PlanItem {
    docType: string
    label: string
    prefix: string
    padding: number
    oldReset: string
    newReset: string
    oldFormat: string
    newFormat: string
    oldEnabled: number
    status: 'INSERT' | 'UPDATE' | 'UNCHANGED'
  }

  const items: PlanItem[] = []

  for (const dt of DOC_TYPES) {
    const cur = existingRows.find(r => r.doc_type === dt.value)
    const prefix = cur?.prefix || dt.defaultPrefix
    const padding = cur?.padding ?? 3
    const oldReset = cur?.reset_period || '-'
    const oldFormat = cur?.date_format || '-'
    const oldEnabled = cur ? cur.enabled : 0

    const isUnchanged = cur &&
      cur.enabled === 1 &&
      cur.prefix === prefix &&
      cur.padding === padding &&
      cur.date_format === 'DDMMYY' &&
      cur.separator === '-' &&
      cur.reset_period === 'DAY'

    items.push({
      docType: dt.value,
      label: dt.label,
      prefix,
      padding,
      oldReset,
      newReset: 'DAY',
      oldFormat,
      newFormat: 'DDMMYY',
      oldEnabled,
      status: !cur ? 'INSERT' : isUnchanged ? 'UNCHANGED' : 'UPDATE',
    })
  }

  console.log(`\n=== ปรับรูปแบบเลขเอกสารเป็น PREFIX-ลำดับ-DDMMYY รีเซ็ตทุกวัน (DAY) ===`)
  console.log(`Tenant: ${tenantId}`)
  console.log(`Mode: ${isApply ? 'APPLY (บันทึกจริง)' : 'DRY-RUN (ดูอย่างเดียว)'}\n`)

  const colDoc = 24
  const colPrefix = 8
  const colPad = 6
  const colReset = 16
  const colStatus = 12

  console.log([
    padEndVisual('เอกสาร', colDoc),
    padEndVisual('Prefix', colPrefix),
    padEndVisual('หลัก', colPad),
    padEndVisual('รอบรีเซ็ต', colReset),
    padEndVisual('สถานะ', colStatus),
  ].join(' | '))
  console.log('-'.repeat(colDoc + colPrefix + colPad + colReset + colStatus + 12))

  for (const item of items) {
    const resetChange = item.oldReset === 'DAY' ? 'DAY' : `${item.oldReset} -> DAY`
    const statusText = item.status === 'INSERT' ? '+ สร้างใหม่' : item.status === 'UPDATE' ? '~ อัปเดต' : '= ไม่เปลี่ยน'
    console.log([
      padEndVisual(item.label, colDoc),
      padEndVisual(item.prefix, colPrefix),
      padEndVisual(String(item.padding), colPad),
      padEndVisual(resetChange, colReset),
      padEndVisual(statusText, colStatus),
    ].join(' | '))
  }

  if (!isApply) {
    console.log('\n[DRY RUN] โหมดตรวจสอบเท่านั้น ไม่ได้เขียนลงฐานข้อมูล (ใส่ --apply เพื่อบันทึกจริง)')
    return items
  }

  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO document_number_formats (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, reset_period, updated_at)
    VALUES (?, ?, 1, ?, ?, 'DDMMYY', '-', 'DAY', ?)
    ON CONFLICT(tenant_id, doc_type) DO UPDATE SET
      enabled = 1,
      prefix = excluded.prefix,
      padding = excluded.padding,
      date_format = 'DDMMYY',
      separator = '-',
      reset_period = 'DAY',
      updated_at = excluded.updated_at
  `)

  db.transaction(() => {
    for (const item of items) {
      upsert.run(tenantId, item.docType, item.prefix, item.padding, now)
    }
  })()

  console.log(`\n✅ บันทึกรูปแบบเลขเอกสารเป็น PREFIX-ลำดับ-DDMMYY รีเซ็ตทุกวัน ให้ tenant "${tenantId}" เรียบร้อย (${items.length} รายการ)`)
  return items
}

if (require.main === module) {
  if (!tenant) {
    console.error('กรุณาระบุ tenant: npx tsx scripts/2026-10-21-daily-doc-numbers.ts --tenant <tenant_id> [--apply]')
    process.exit(1)
  }
  runDailyDocNumbers(tenant, apply)
}
