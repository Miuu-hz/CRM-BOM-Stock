#!/usr/bin/env node
'use strict'

/**
 * Backfill: ใบแจ้งหนี้ซื้อเก่าที่มีบรรทัด skip_stock (น้ำมัน/ของใช้สำนักงาน/ของไม่นับสต็อก) แต่ยังลง
 * Dr 1107 (สต็อกวัตถุดิบ) เต็มจำนวน — ใช้สูตรเดียวกับ postPurchaseInvoiceJournal (purchaseBilling.service.ts
 * หลังแก้ 2026-10) คำนวณส่วนที่ "ควรจะ" ลงบัญชีค่าใช้จ่ายแทน แล้วโพสต์ journal ปรับปรุง
 * Dr บัญชีค่าใช้จ่าย (ต่อบรรทัด ตาม purchase_order_items.expense_account_id) / Cr 1107 หนึ่งใบต่อ
 * invoice — ไม่แก้ journal เดิม (ประวัติต้องอยู่ครบ)
 *
 * ต้องรัน scripts/classifyNonStockLines.js --apply ก่อน (ใบนี้อ่าน expense_account_id ที่ตั้งไว้แล้ว)
 * ถ้าคอลัมน์/ข้อมูลยังไม่พร้อม ทุกบรรทัด skip_stock ของใบนั้นจะรวมเป็น bucket เดียว (5403) เหมือนพฤติกรรมเดิม
 *
 * Default = DRY-RUN (อ่านอย่างเดียว, ไม่แตะ DB) พิมพ์ตารางที่จะย้าย + รวมต่อบัญชี/tenant
 * --apply                 = ลงจริง (backup dev.db ก่อนเสมอ) ภายใน transaction เดียว — ต้องมีคอลัมน์ expense_account_id แล้ว
 * --preview-classification = dry-run เท่านั้น: จำลองผล classifyNonStockLines.js ในหน่วยความจำ (ไม่เขียน DB)
 *   ให้เห็นภาพการแบ่งบัญชีจริงก่อนรัน classify --apply จริง ๆ
 *
 * รันจาก /opt/crm/backend เท่านั้น (module resolution ของ dist/*)
 *   node scripts/reclassSkipStockInvoices.js                         ← dry-run (bucket เดียว ถ้ายังไม่ classify)
 *   node scripts/reclassSkipStockInvoices.js --preview-classification ← dry-run จำลองผลหลัง classify
 *   node scripts/reclassSkipStockInvoices.js --apply                  ← ลงจริง (ต้อง classify --apply แล้ว)
 *
 * ponytail: สคริปต์ one-off แก้ข้อมูลเก่าครั้งเดียว ไม่ใช่ service ถาวร — เขียนตรง ๆ ไฟล์เดียว
 * ไม่แยก module ถ้าต้องรันซ้ำเป็นประจำค่อยยกเป็น migration
 */

const path = require('path')
const Database = require('better-sqlite3')
const { classify } = require('./classifyNonStockLines')

const APPLY = process.argv.includes('--apply')
const PREVIEW = process.argv.includes('--preview-classification')
const DB_PATH = path.join(__dirname, '..', 'dev.db')

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** แบ่ง total ลงแต่ละ bucket ตามสัดส่วน rawSubtotal — บรรทัดสุดท้ายรับเศษปัดทั้งหมด (กันดุลไม่ลง)
 *  พอร์ตจาก allocateByBucket ใน purchaseBilling.service.ts ให้ตรงสูตรเดียวกัน */
function allocateByBucket(buckets, total) {
  if (buckets.length === 0 || total <= 0.005) return []
  const rawTotal = buckets.reduce((s, b) => s + b.rawSubtotal, 0)
  if (rawTotal <= 0.005) return []
  let allocated = 0
  return buckets.map((b, i) => {
    if (i === buckets.length - 1) return { code: b.code, amount: r2(total - allocated) }
    const amt = r2(total * (b.rawSubtotal / rawTotal))
    allocated = r2(allocated + amt)
    return { code: b.code, amount: amt }
  })
}

function hasExpenseAccountColumn(db) {
  const cols = db.prepare('PRAGMA table_info(purchase_order_items)').all()
  return cols.some((c) => c.name === 'expense_account_id')
}

function isVatRegistered(db, tenantId) {
  const row = db.prepare('SELECT * FROM company_settings WHERE tenant_id = ?').get(tenantId)
  // null = ไม่มีแถว company_settings เลย — tenant ทดสอบ/ขยะ ไม่ใช่กิจการจริง (ดูสคริปต์ list แยก)
  if (!row) return null
  return row.vat_registered !== 0
}

function closedPeriodLabel(db, tenantId, dateStr) {
  const ymd = String(dateStr).includes('T') ? String(dateStr).split('T')[0] : String(dateStr)
  const [year, month] = ymd.split('-').map(Number)
  const period = db.prepare('SELECT status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?').get(tenantId, year, month)
  return period && period.status === 'CLOSED' ? `${month}/${year}` : null
}

/** bucket code (รหัสบัญชี) ของบรรทัด skip_stock หนึ่งบรรทัด
 *  - ถ้ามี expense_account_id จริงแล้ว (classify --apply ไปแล้ว) ใช้ accounts.code ของมัน
 *  - ถ้าไม่มี (NULL หรือคอลัมน์ยังไม่มี) และสั่ง --preview-classification → จำลองด้วย classify()
 *  - ไม่งั้น fallback 5403 บัญชีเดียว (พฤติกรรมเดิมก่อนมีบัญชีต่อบรรทัด) */
function resolveBucketCode(db, item, hasCol) {
  if (hasCol && item.expenseAccountId) {
    const acc = db.prepare('SELECT code FROM accounts WHERE id = ?').get(item.expenseAccountId)
    if (acc) return acc.code
  }
  if (PREVIEW) return classify(item.description).code
  return '5403'
}

/**
 * คำนวณใบแจ้งหนี้ทุกใบ (ทุก tenant) ที่มีบรรทัด skip_stock และยังมี 1107 ค้างอยู่ในจำนวนที่ควรย้าย
 * สูตรเดียวกับ calcPurchaseInvoiceTotals/postPurchaseInvoiceJournal ฝั่งโค้ด แต่คำนวณจากตัวเลข
 * ที่เก็บไว้แล้วในใบ (subtotal/discount/tax/total) ไม่ใช่คำนวณใหม่จาก calcVat เพราะใบเก่าลงบัญชี
 * ไปแล้วด้วยยอดที่ปัดแล้ว ใช้ตัวเลขที่ลงจริงแม่นกว่า
 *
 * ยอดรวมที่ย้าย (moveAmount) คำนวณเหมือนเดิมทุกตัวอักษร ต่างกันแค่ตอนแบ่งลง Dr: ตอนนี้แบ่งตาม
 * bucket (บัญชีค่าใช้จ่ายต่อบรรทัด) ด้วย allocateByBucket แทนการโยนเข้า 5403 บัญชีเดียว — ถ้าถูก cap
 * (moveAmount < wantMove) สัดส่วนยังคงเดิมเพราะ allocateByBucket แบ่ง "moveAmount ที่ cap แล้ว" ตรง ๆ
 */
function computeCandidates(db) {
  const hasCol = hasExpenseAccountColumn(db)
  const pis = db.prepare(`
    SELECT pi.id, pi.pi_number, pi.tenant_id, pi.invoice_date, pi.tax_amount, pi.total_amount, pi.status
    FROM purchase_invoices pi
    WHERE pi.status != 'CANCELLED'
    AND EXISTS (
      SELECT 1 FROM purchase_invoice_items pii JOIN purchase_order_items poi ON poi.id = pii.purchase_order_item_id
      WHERE pii.purchase_invoice_id = pi.id AND COALESCE(poi.skip_stock, 0) = 1
    )
    ORDER BY pi.tenant_id, pi.invoice_date
  `).all()

  const toMove = []
  const skipped = []

  for (const pi of pis) {
    const items = db.prepare(`
      SELECT pii.quantity, pii.unit_price, COALESCE(poi.skip_stock, 0) as skipStock, poi.description as description
        ${hasCol ? ', poi.expense_account_id as expenseAccountId' : ''}
      FROM purchase_invoice_items pii JOIN purchase_order_items poi ON poi.id = pii.purchase_order_item_id
      WHERE pii.purchase_invoice_id = ?
    `).all(pi.id)
    const subtotalRaw = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
    const skipItems = items.filter(it => it.skipStock)
    const skipSubtotalRaw = skipItems.reduce((s, it) => s + it.quantity * it.unit_price, 0)
    const skipShare = subtotalRaw > 0.005 ? Math.max(0, Math.min(1, skipSubtotalRaw / subtotalRaw)) : 0
    if (skipShare <= 0.0001) continue // EXISTS เจอบรรทัด skip_stock แต่มูลค่า 0 (ไม่มีผลจริง)

    // journal ปัจจุบัน — ของเก่าที่ถูกแก้ไขจะถูก relabel เป็น PURCHASE_INVOICE_SUPERSEDED แล้ว ไม่โผล่ที่นี่
    const je = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
    ).get(pi.tenant_id, pi.id)
    if (!je) { skipped.push({ pi, reason: 'ไม่พบ journal ปัจจุบันของใบนี้ (ผิดปกติ — ข้ามไว้ก่อน)' }); continue }

    const already = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE_RECLASS' AND reference_id = ?"
    ).get(pi.tenant_id, pi.id)
    if (already) { skipped.push({ pi, reason: 'มี RECLASS journal อยู่แล้ว (ทำไปแล้ว — idempotent)' }); continue }

    const closed = closedPeriodLabel(db, pi.tenant_id, pi.invoice_date)
    if (closed) { skipped.push({ pi, reason: `งวด ${closed} ปิดแล้ว` }); continue }

    const line1107 = db.prepare(`
      SELECT COALESCE(SUM(l.debit), 0) as d FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = ? AND a.code = '1107'
    `).get(je.id)
    const actual1107 = r2(line1107.d)
    if (actual1107 <= 0.005) continue // ไม่มี 1107 ให้ย้าย (แก้แล้ว หรือใบนี้ไม่เคยลง 1107 เลย)

    const vatClaimable = isVatRegistered(db, pi.tenant_id) // null = tenant ไม่มี company_settings (ขยะ)
    if (vatClaimable === null) { skipped.push({ pi, reason: 'tenant ไม่มี company_settings — ไม่ใช่กิจการจริง (ขยะ)' }); continue }

    const payableTotal = r2(pi.total_amount)
    const vatDebit = pi.tax_amount > 0 ? r2(pi.tax_amount) : 0
    const goodsDebit = r2(payableTotal - vatDebit)
    // สูตรเดียวกับ postPurchaseInvoiceJournal: ส่วน skip_stock ของยอดสินค้า คิดจาก goodsDebit ทั้งก้อน
    const expensePortion = Math.max(0, Math.min(goodsDebit, r2(goodsDebit * skipShare)))
    // ยังไม่จด VAT: ภาษีซื้อขอคืนไม่ได้ก็รวมอยู่ใน 1107 เดิม — ต้องแยกส่วน skip_stock ของมันออกด้วย
    const vatExpensePortion = (vatClaimable === false) ? Math.max(0, Math.min(vatDebit, r2(vatDebit * skipShare))) : 0
    const wantMove = r2(expensePortion + vatExpensePortion)
    const moveAmount = Math.min(wantMove, actual1107) // ห้ามย้ายมากกว่าที่ 1107 มีอยู่จริงในใบนี้
    if (moveAmount <= 0.005) continue

    const bucketRaw = {}
    for (const it of skipItems) {
      const code = resolveBucketCode(db, it, hasCol) || '5403'
      bucketRaw[code] = (bucketRaw[code] || 0) + it.quantity * it.unit_price
    }
    const bucketList = Object.entries(bucketRaw).map(([code, rawSubtotal]) => ({ code, rawSubtotal }))
    const allocations = allocateByBucket(bucketList, moveAmount)

    toMove.push({
      piId: pi.id, piNumber: pi.pi_number, tenantId: pi.tenant_id, invoiceDate: pi.invoice_date,
      actual1107, wantMove, moveAmount, capped: wantMove > actual1107 + 0.005, allocations,
    })
  }

  return { toMove, skipped }
}

function printReport(toMove, skipped) {
  const title = PREVIEW
    ? '=== Dry-run (preview ตาม classify ที่ยังไม่ apply จริง): ใบแจ้งหนี้ซื้อที่ควรย้าย skip_stock ออกจาก 1107 ==='
    : '=== Dry-run: ใบแจ้งหนี้ซื้อที่ควรย้ายส่วน skip_stock ออกจาก 1107 ==='
  console.log(title + '\n')
  console.log('pi_number'.padEnd(18), 'tenant'.padEnd(22), 'วันที่'.padEnd(12), '1107 เดิม'.padStart(10), 'ย้ายรวม'.padStart(10), 'แยกตามบัญชี')
  for (const r of toMove) {
    const allocStr = r.allocations.map(a => `${a.code}:${a.amount.toFixed(2)}`).join(', ')
    console.log(
      r.piNumber.padEnd(18), r.tenantId.padEnd(22), String(r.invoiceDate).slice(0, 10).padEnd(12),
      r.actual1107.toFixed(2).padStart(10), (r.moveAmount.toFixed(2) + (r.capped ? '*' : '')).padStart(10),
      allocStr
    )
  }
  console.log('\n* = ยอดที่ควรย้ายตามสัดส่วนมากกว่ายอด 1107 จริงที่มีอยู่ ย้ายแค่เท่าที่มี (ไม่ให้ 1107 ติดลบ — สัดส่วนต่อบัญชียังคงเดิม)\n')

  const perAccount = {}
  for (const r of toMove) for (const a of r.allocations) perAccount[a.code] = r2((perAccount[a.code] || 0) + a.amount)
  console.log('--- รวมต่อบัญชี (ทุก tenant) ---')
  for (const [code, amt] of Object.entries(perAccount)) console.log(`  ${code}: ฿${amt.toFixed(2)}`)

  const perTenant = {}
  for (const r of toMove) perTenant[r.tenantId] = r2((perTenant[r.tenantId] || 0) + r.moveAmount)
  console.log('\n--- รวมต่อ tenant ---')
  for (const [t, total] of Object.entries(perTenant)) console.log(`  ${t}: ฿${total.toFixed(2)} (${toMove.filter(r => r.tenantId === t).length} ใบ)`)
  console.log(`  รวมทั้งหมด: ฿${r2(Object.values(perTenant).reduce((s, v) => s + v, 0)).toFixed(2)} (${toMove.length} ใบ)\n`)

  if (skipped.length > 0) {
    console.log('--- ข้ามไว้ (ไม่ย้าย) ---')
    for (const s of skipped) console.log(`  ${s.pi.pi_number} [${s.pi.tenant_id}]: ${s.reason}`)
  }
}

function applyReclass(db, postJournal, getOrCreateAccount, toMove) {
  const insertAll = db.transaction(() => {
    for (const r of toMove) {
      const description = `ปรับปรุงย้ายค่าใช้จ่ายไม่นับสต็อกออกจากสต็อก ${r.piNumber}`
      const lines = []
      for (const a of r.allocations) {
        if (a.amount <= 0.005) continue
        // ชื่อบัญชีเอาจากที่มีอยู่แล้วของ tenant นี้ (classify --apply สร้าง/ผูกไว้ก่อนแล้วเสมอ)
        // getOrCreateAccount ไม่ได้ใช้สร้างใหม่จริง เป็นแค่ fallback กันพังถ้าบัญชีหาย
        const accRow = db.prepare('SELECT name FROM accounts WHERE tenant_id = ? AND code = ?').get(r.tenantId, a.code)
        const accId = getOrCreateAccount(r.tenantId, a.code, accRow ? accRow.name : a.code, 'EXPENSE', 'OTHER', 'DEBIT')
        lines.push({ accountId: accId, description, debit: a.amount })
      }
      lines.push({ code: '1107', description, credit: r.moveAmount })
      postJournal({
        tenantId: r.tenantId,
        date: String(r.invoiceDate).slice(0, 10),
        referenceType: 'PURCHASE_INVOICE_RECLASS',
        referenceId: r.piId,
        description,
        lines,
        createdBy: 'system:reclassSkipStockInvoices',
      })
    }
  })
  insertAll()
}

function main() {
  if (!APPLY) {
    // dry-run: เปิด connection ของตัวเองแบบ readonly ล้วน ๆ ไม่ผ่าน dist (ไม่ต้องรัน migration ของแอปจริง)
    const db = new Database(DB_PATH, { readonly: true })
    const { toMove, skipped } = computeCandidates(db)
    printReport(toMove, skipped)
    console.log('(dry-run — ไม่มีอะไรถูกเขียนลง DB. รันด้วย --apply เพื่อลงจริง)')
    db.close()
    return
  }

  // apply: ต้องใช้ db connection เดียวกับที่ dist/services/accounting.service.js ใช้อยู่จริง (singleton
  // ของ dist/db/sqlite.js) ไม่เปิด better-sqlite3 คู่ขนานของตัวเอง — ไม่งั้น backup()/transaction() ที่นี่
  // กับ postJournal ของ dist จะเป็นคอนเนกชันคนละตัว ไม่ใช่ transaction เดียวกันจริง (ล็อกชนกันได้ด้วย)
  const db = require(path.join(__dirname, '..', 'dist', 'db', 'sqlite.js')).default
  const { postJournal, getOrCreateAccount } = require(path.join(__dirname, '..', 'dist', 'services', 'accounting.service.js'))

  if (!hasExpenseAccountColumn(db)) {
    console.error('ยังไม่มีคอลัมน์ purchase_order_items.expense_account_id — ต้อง deploy Task A แล้วรัน scripts/classifyNonStockLines.js --apply ก่อน')
    process.exitCode = 1
    return
  }

  const { toMove, skipped } = computeCandidates(db)
  printReport(toMove, skipped)

  if (toMove.length === 0) {
    console.log('ไม่มีรายการให้ย้าย — ไม่ทำอะไร')
    return
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(__dirname, '..', `dev.db.bak-reclass-${ts}`)
  console.log(`กำลัง backup ${DB_PATH} → ${backupPath} ...`)
  db.backup(backupPath)
    .then(() => {
      console.log('backup เสร็จแล้ว — เริ่มลงจริง')
      applyReclass(db, postJournal, getOrCreateAccount, toMove)
      console.log(`ลงจริงเสร็จ: ${toMove.length} ใบ`)
    })
    .catch((err) => {
      console.error('backup ล้มเหลว — ไม่แตะ DB จริง:', err)
      process.exitCode = 1
    })
}

main()
