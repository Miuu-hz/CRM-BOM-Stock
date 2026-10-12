#!/usr/bin/env node
'use strict'

/**
 * จัดหมวดบรรทัด skip_stock (ของไม่นับสต็อก เช่นน้ำมัน/ของใช้สิ้นเปลือง) เก่าของ tenant_bb_pillow
 * ด้วย description keyword — ตั้ง purchase_order_items.expense_account_id ให้ตรงบัญชีค่าใช้จ่ายที่ควรลง
 * บรรทัดที่ไม่เข้ากฎไหนเลย fallback ไปบัญชี 5403 (ค่าใช้จ่ายอื่น) และพิมพ์แยกให้เจ้าของยืนยัน
 *
 * Default = DRY-RUN (อ่านอย่างเดียว, ไม่แตะ DB)
 * --apply  = backup dev.db ก่อนเสมอ (dev.db.bak-classify-<ts>) แล้วอัปเดตจริงใน transaction เดียว
 *
 * รันจาก /opt/crm/backend เท่านั้น
 *   node scripts/classifyNonStockLines.js            ← dry-run
 *   node scripts/classifyNonStockLines.js --apply     ← ลงจริง
 *
 * เฉพาะบรรทัดที่ expense_account_id ยังเป็น NULL เท่านั้น (idempotent — รันซ้ำไม่ทับของที่จัดไปแล้ว
 * หรือที่คนแก้มือทีหลัง) และเฉพาะ PO ที่ status != CANCELLED
 *
 * ลำดับกฎ (first match wins) ตั้งใจเอา 5313 (วัสดุสิ้นเปลือง) ไว้ก่อน 5204 (บรรจุภัณฑ์) เพราะคำว่า
 * "ถุง" โผล่ทั้งสองฝั่ง ("ถุงขยะ" ต้องไม่โดนจับเป็นบรรจุภัณฑ์) — ตรวจผลจริงได้จาก dry-run ด้านล่าง
 *
 * export classify()/RULES ให้ scripts/reclassSkipStockInvoices.js เรียกซ้ำได้ (--preview-classification)
 *
 * ponytail: สคริปต์ one-off จัดข้อมูลเก่าครั้งเดียว ไม่ใช่ service ถาวร — เขียนตรง ๆ ไฟล์เดียว
 */

const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const APPLY = process.argv.includes('--apply')
const DB_PATH = path.join(__dirname, '..', 'dev.db')
const TENANT_ID = 'tenant_bb_pillow'

// first match wins
const RULES = [
  { code: '5308', name: 'ค่าใช้จ่ายเดินทาง', keywords: ['น้ำมัน'] },
  { code: '5307', name: 'ค่าซ่อมแซมและบำรุงรักษา', keywords: ['ก๊อก', 'เทปพันเกลียว', 'ท่อ'] },
  { code: '5102', name: 'ต้นทุนวัตถุดิบใช้ไป', keywords: ['หัวไหล่หมู', 'ก๋วยจั๊บ', 'มาร์ชแมลโลว์', 'เกล็ดน้ำตาล', 'น้ำสตรอเบอร์รี่', 'หมูยอ', 'ข้าวโพด'] },
  // 5313 ก่อน 5204 โดยตั้งใจ — ดูหมายเหตุหัวไฟล์
  { code: '5313', name: 'ค่าวัสดุสิ้นเปลือง', keywords: ['ซันไลต์', 'โอโม่', 'คอมฟอร์ท', 'เน็ตโปรแคร์', 'ถุงขยะ', 'ถุงมือ', 'เช็ดปาก', 'ตะหลิว', 'ไม้กวาด'] },
  { code: '5204', name: 'ค่าใช้จ่ายบรรจุภัณฑ์', keywords: ['กล่อง', 'ถุงกระดาษ', 'ถุงหูหิ้ว', 'ถุงร้อน', 'ถุงใส่แก้ว', 'ถ้วย', 'ชาม', 'ถาด', 'กระดาษรองอาหาร', 'กระดาษห่อ', 'หลอด', 'PG-', 'ล็อค'] },
  { code: '5306', name: 'ค่าวัสดุสำนักงาน', keywords: ['กระดาษ A4'] },
]
const FALLBACK = { code: '5403', name: 'ค่าใช้จ่ายอื่น' }

/** จัดหมวดบรรทัดเดียวจาก description — คืน { code, name, matched } (matched=false ถ้า fallback) */
function classify(description) {
  const desc = String(description || '').toLowerCase()
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (desc.includes(kw.toLowerCase())) return { code: rule.code, name: rule.name, matched: true }
    }
  }
  return { code: FALLBACK.code, name: FALLBACK.name, matched: false }
}

function hasExpenseAccountColumn(db) {
  const cols = db.prepare('PRAGMA table_info(purchase_order_items)').all()
  return cols.some((c) => c.name === 'expense_account_id')
}

function fetchCandidates(db) {
  const hasCol = hasExpenseAccountColumn(db)
  // ยังไม่ migrate (คอลัมน์ยังไม่มี) — ถือว่าทุกบรรทัด skip_stock ยังไม่ได้จัดหมวด (ยังไงคอลัมน์ก็ไม่มีให้กรอง)
  const filter = hasCol ? 'AND poi.expense_account_id IS NULL' : ''
  return db.prepare(`
    SELECT poi.id, poi.description, poi.quantity, poi.unit_price, poi.total_price, po.po_number
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.tenant_id = ? AND po.status != 'CANCELLED'
      AND COALESCE(poi.skip_stock, 0) = 1
      ${filter}
    ORDER BY po.po_number
  `).all(TENANT_ID)
}

function printReport(rows) {
  console.log(`=== Dry-run: จัดหมวดบรรทัด skip_stock ของ ${TENANT_ID} (${rows.length} บรรทัดยังไม่จัดหมวด) ===\n`)
  console.log('po_number'.padEnd(16), 'รายการ'.padEnd(36), 'มูลค่า'.padStart(10), '→ บัญชี')

  const perCode = {}
  const needConfirm = []
  for (const r of rows) {
    const c = classify(r.description)
    const amt = Number(r.total_price) || 0
    perCode[c.code] = perCode[c.code] || { name: c.name, count: 0, amount: 0 }
    perCode[c.code].count++
    perCode[c.code].amount += amt
    console.log(
      r.po_number.padEnd(16), String(r.description).slice(0, 36).padEnd(36),
      amt.toFixed(2).padStart(10), `${c.code} ${c.name}`
    )
    if (!c.matched) needConfirm.push({ r, amt })
  }

  console.log('\n--- รวมตามบัญชี ---')
  let grandTotal = 0
  for (const [code, v] of Object.entries(perCode)) {
    console.log(`  ${code} ${v.name}: ${v.count} บรรทัด ฿${v.amount.toFixed(2)}`)
    grandTotal += v.amount
  }
  console.log(`  รวมทั้งหมด: ${rows.length} บรรทัด ฿${grandTotal.toFixed(2)}`)

  if (needConfirm.length > 0) {
    console.log(`\n--- ให้เจ้าของยืนยัน (${needConfirm.length} บรรทัด ไม่เข้ากฎไหน → fallback 5403) ---`)
    for (const { r, amt } of needConfirm) console.log(`  ${r.po_number}: "${r.description}" ฿${amt.toFixed(2)}`)
  }

  return { perCode, needConfirm }
}

/** resolve code -> account id ของ tenant นี้ — 5313 เป็นบัญชีใหม่ สร้างให้ถ้ายังไม่มี (เช่น backend ยังไม่ restart
 *  ให้ backfillChartOfAccounts รันหลังมี 5313 ใน DEFAULT_CHART_OF_ACCOUNTS) โค้ดอื่นต้องมีอยู่แล้วจากผังบัญชีมาตรฐาน */
function resolveAccountId(db, tenantId, code, name) {
  const row = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code)
  if (row) return row.id
  if (code !== '5313') {
    throw new Error(`ไม่พบบัญชี ${code} ของ tenant ${tenantId} — ควรมีอยู่แล้วจากผังบัญชีมาตรฐาน ตรวจ backfillChartOfAccounts ก่อน`)
  }
  const parent = db.prepare("SELECT id FROM accounts WHERE tenant_id = ? AND code = '53'").get(tenantId)
  const id = crypto.randomBytes(13).toString('hex').slice(0, 25)
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, is_system, normal_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'EXPENSE', 'SUPPLIES', ?, 2, 1, 1, 'DEBIT', ?, ?)
  `).run(id, tenantId, code, name, parent ? parent.id : null, now, now)
  console.log(`✅ สร้างบัญชี ${code} ${name} ให้ ${tenantId} แล้ว (id=${id})`)
  return id
}

function applyClassification(db, rows) {
  const update = db.prepare('UPDATE purchase_order_items SET expense_account_id = ? WHERE id = ?')
  const idCache = {}
  const tx = db.transaction(() => {
    for (const r of rows) {
      const c = classify(r.description)
      if (!idCache[c.code]) idCache[c.code] = resolveAccountId(db, TENANT_ID, c.code, c.name)
      update.run(idCache[c.code], r.id)
    }
  })
  tx()
}

function main() {
  if (!APPLY) {
    const db = new Database(DB_PATH, { readonly: true })
    const rows = fetchCandidates(db)
    printReport(rows)
    console.log('\n(dry-run — ไม่มีอะไรถูกเขียนลง DB. รันด้วย --apply เพื่อลงจริง)')
    db.close()
    return
  }

  const db = new Database(DB_PATH)
  if (!hasExpenseAccountColumn(db)) {
    console.error('ยังไม่มีคอลัมน์ purchase_order_items.expense_account_id — ต้อง deploy โค้ด/migration (Task A) ก่อนรัน --apply')
    db.close()
    process.exitCode = 1
    return
  }

  const rows = fetchCandidates(db)
  printReport(rows)

  if (rows.length === 0) {
    console.log('ไม่มีรายการให้จัดหมวด — ไม่ทำอะไร')
    db.close()
    return
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(__dirname, '..', `dev.db.bak-classify-${ts}`)
  console.log(`\nกำลัง backup ${DB_PATH} → ${backupPath} ...`)
  db.backup(backupPath)
    .then(() => {
      console.log('backup เสร็จแล้ว — เริ่มลงจริง')
      applyClassification(db, rows)
      console.log(`ลงจริงเสร็จ: ${rows.length} บรรทัด`)
      db.close()
    })
    .catch((err) => {
      console.error('backup ล้มเหลว — ไม่แตะ DB จริง:', err)
      process.exitCode = 1
      db.close()
    })
}

module.exports = { classify, RULES, FALLBACK }

if (require.main === module) main()
