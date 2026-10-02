// รันกับ "สำเนา" DB เท่านั้น — import src จะรัน migration ใส่ DB ที่ชี้อยู่
//   node -e "require(\"better-sqlite3\")(\"dev.db\",{readonly:true}).backup(\"/tmp/devcopy.db\")"
//   JWT_SECRET=x AGENT_JWT_SECRET=x SQLITE_DB_PATH=/tmp/devcopy.db npx tsx scripts/check-source-docs.ts
import db from '../src/db/sqlite'
import { buildSourceDoc } from '../src/routes/journalSource.routes'
import { buildLedger } from '../src/routes/reports.routes'

const KINDS = ['PURCHASE_REQUEST', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'SUPPLIER_PAYMENT',
  'SALES_ORDER', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'POS_SALE', 'STOCK_ADJUST']
const TABLE: Record<string, string> = { PURCHASE_REQUEST: 'purchase_requests', PURCHASE_ORDER: 'purchase_orders', GOODS_RECEIPT: 'goods_receipts',
  PURCHASE_INVOICE: 'purchase_invoices', SUPPLIER_PAYMENT: 'supplier_payments', SALES_ORDER: 'sales_orders', INVOICE: 'invoices',
  PAYMENT: 'receipts', CREDIT_NOTE: 'credit_notes', POS_SALE: 'pos_running_bills' }
let fail = 0
for (const T of ['tenant_bb_pillow', 'Testshop']) {
  console.log('\n##', T)
  for (const k of KINDS) {
    const row = k === 'STOCK_ADJUST'
      ? db.prepare("SELECT reference_id id FROM journal_entries WHERE tenant_id=? AND reference_type='STOCK_ADJUST' LIMIT 1").get(T) as any
      : db.prepare(`SELECT id FROM ${TABLE[k]} WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1`).get(T) as any
    if (!row) { console.log(k.padEnd(17), '— ไม่มีข้อมูล'); continue }
    const d = buildSourceDoc(T, k, row.id)
    if (!d) { fail++; console.log(k.padEnd(17), '❌ null'); continue }
    console.log(k.padEnd(17), `${d.docNumber} · สร้าง ${String(d.createdAt).slice(0, 10)} · ${d.status ?? '-'} · items ${d.items.length} · ${JSON.stringify(d.amounts)} · สาย: ${d.chain.map(c => c.number).join(' → ') || '-'}`)
    // ข้าม tenant ต้องไม่เจอ
    if (buildSourceDoc(T === 'Testshop' ? 'tenant_bb_pillow' : 'Testshop', k, row.id)) { fail++; console.log('   ❌ tenant leak') }
  }
}
// PI ที่ไม่มีรายการของตัวเอง ต้องได้รายการจาก PO
const pi = db.prepare(`SELECT id FROM purchase_invoices pi WHERE tenant_id='tenant_bb_pillow' AND purchase_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM purchase_invoice_items x WHERE x.purchase_invoice_id = pi.id) LIMIT 1`).get() as any
if (pi) { const d = buildSourceDoc('tenant_bb_pillow', 'PURCHASE_INVOICE', pi.id)!; console.log('\nPI ไม่มีรายการ →', d.items.length, 'รายการ ·', d.itemsNote); if (!d.items.length) fail++ }
// ชนิดแปลก ๆ ต้องได้ null
if (buildSourceDoc('tenant_bb_pillow', 'users', 'x') !== null) { fail++; console.log('❌ unknown kind') }
// ledger มี journalEntryId
const acc = db.prepare("SELECT id FROM accounts WHERE tenant_id='tenant_bb_pillow' AND code='1102' LIMIT 1").get() as any
if (acc) { const l = buildLedger('tenant_bb_pillow', acc.id)!; const t = l.transactions[0]; console.log('ledger row:', t && { journalEntryId: t.journalEntryId, sourceNumber: t.sourceNumber, entryNumber: t.entryNumber }); if (t && !t.journalEntryId) fail++ }
console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ ALL OK')
process.exit(fail ? 1 : 0)
