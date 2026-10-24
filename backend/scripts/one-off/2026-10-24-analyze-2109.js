// วิเคราะห์ยอดค้าง 2109 (ของรับแล้วยังไม่ได้รับใบแจ้งหนี้) ของ PO ราคารวม VAT 5 ใบ (tenant_bb_pillow) — 2026-10-24
// อ่านอย่างเดียว: เปิดฐานข้อมูลแบบ readonly ไม่เขียนอะไรเลย แค่พิมพ์รายงาน + รายการปรับปรุงที่เสนอ
// ใช้: node 2026-10-24-analyze-2109.js [path/to/dev.db]   (ค่าตั้งต้น /opt/crm/backend/dev.db)
//
// สาเหตุที่พบจริง (tenant_bb_pillow ไม่จด VAT): GR ตั้ง 2109/1107 รวม VAT แต่ใบแจ้งหนี้รุ่นเก่าปิด 2109 แค่ยอดถอด VAT แล้ว Dr 1107 ภาษีซ้ำ
// สาเหตุอื่นที่สคริปต์แยกให้ (บั๊กที่แก้ในสาขา p-opus-acct): ยืนยัน GR ตั้ง Dr 1107 / Cr 2109 ที่ "ราคาดิบบน PO" ซึ่งรวม VAT
// แต่ใบแจ้งหนี้ (กิจการจด VAT) ปิด 2109 ได้แค่ยอดไม่รวม VAT (min(ยอดตั้ง, ยอดของในบิล)) → ส่วน VAT ค้าง Cr 2109
// และ 1107 ในงบสูงเกินเท่ากัน (ทะเบียนสต็อก unit_cost ถูกอยู่แล้ว — ใช้ราคาถอด VAT) · ส่วนลดท้ายบิล/ราคาบิลต่ำกว่า PO
// ทำให้ค้างแบบเดียวกัน
const D = require('/opt/crm/backend/node_modules/better-sqlite3')

const DB_PATH = process.argv[2] || '/opt/crm/backend/dev.db'
const TENANT = 'tenant_bb_pillow'
const PO_NUMBERS = ['PO-050-040826', 'PO-057-280826', 'PO-052-090826', 'PO-054-180826', 'PO-061-121026']
const CODES = ['2109', '1107', '1110', '2101']
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const fmt = n => r2(n).toFixed(2).padStart(10)

const db = new D(DB_PATH, { readonly: true, fileMustExist: true })
const vatRegistered = (db.prepare('SELECT vat_registered FROM company_settings WHERE tenant_id = ?').get(TENANT) || {}).vat_registered !== 0

const linesOf = db.prepare(`
  SELECT a.code, a.name, l.debit, l.credit, l.description
  FROM journal_lines l JOIN accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = ? ORDER BY l.line_number`)
const entriesFor = ids => ids.length === 0 ? [] : db.prepare(`
  SELECT id, entry_number, date, reference_type, reference_id, description FROM journal_entries
  WHERE tenant_id = ? AND reference_id IN (${ids.map(() => '?').join(',')}) ORDER BY date, created_at`).all(TENANT, ...ids)
const net2109 = entryId => r2(linesOf.all(entryId).filter(l => l.code === '2109').reduce((s, l) => s + l.credit - l.debit, 0))

const proposals = []
for (const poNumber of PO_NUMBERS) {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE tenant_id = ? AND po_number = ?').get(TENANT, poNumber)
  console.log('\n' + '='.repeat(100))
  if (!po) { console.log(`${poNumber}: ไม่พบ`); continue }
  console.log(`${poNumber}  สถานะ ${po.status}  VAT ${po.tax_rate}% ${po.vat_inclusive === 1 ? 'รวมในราคา' : 'แยก'}  ส่วนลด ${r2(po.discount_amount)}  ยอด ${r2(po.total_amount)}  (กิจการ${vatRegistered ? 'จด' : 'ไม่จด'} VAT)`)

  const grs = db.prepare('SELECT * FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? ORDER BY created_at').all(TENANT, po.id)
  const pis = db.prepare(`SELECT * FROM purchase_invoices WHERE tenant_id = ? AND (purchase_order_id = ? OR purchase_order_ids LIKE ?) ORDER BY created_at`)
    .all(TENANT, po.id, `%"${po.id}"%`)
  const rets = db.prepare('SELECT * FROM purchase_returns WHERE tenant_id = ? AND purchase_order_id = ?').all(TENANT, po.id)

  // ยอดที่ GR ตั้งไว้ vs ยอดที่ "ควร" ตั้ง (ต้นทุนจริง = ถอด VAT เมื่อจด VAT + PO รวม VAT)
  let accruedAll = 0, expectedAll = 0, accruedInvoiced = 0, rawInvoiced = 0
  for (const gr of grs) {
    const items = db.prepare(`SELECT gri.accepted_qty, poi.unit_price, poi.skip_stock, gri.material_id, poi.description
      FROM goods_receipt_items gri JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id WHERE gri.goods_receipt_id = ?`).all(gr.id)
    const raw = items.filter(i => i.material_id && i.accepted_qty > 0 && !i.skip_stock).reduce((s, i) => s + i.accepted_qty * i.unit_price, 0)
    const rate = Number(po.tax_rate) || 0
    const expected = vatRegistered && po.vat_inclusive === 1 && rate ? raw / (1 + rate / 100) : (!vatRegistered && po.vat_inclusive !== 1 && rate ? raw * (1 + rate / 100) : raw)
    const posted = entriesFor([gr.id]).reduce((s, e) => s + net2109(e.id), 0)
    console.log(`  GR ${gr.gr_number} ${gr.status} ${gr.invoiced_at ? 'ออกบิลแล้ว' : 'ยังไม่ออกบิล'}  ตั้ง 2109 สุทธิ ${fmt(posted)}  (ราคาดิบ ${fmt(raw)} · ต้นทุนจริง ${fmt(expected)})`)
    if (gr.status === 'CONFIRMED') {
      accruedAll += posted
      expectedAll += expected
      if (gr.invoiced_at) { accruedInvoiced += posted; rawInvoiced += raw }
    }
  }

  // ทุก journal ของ GR / PI / ใบคืน ของ PO นี้ — รายการแก้ไข/ยกเลิกกลับกันเอง ผลรวมจึงเป็นยอดสุทธิจริง
  const ids = [...grs.map(g => g.id), ...pis.map(p => p.id), ...rets.map(r => r.id)]
  let clearedByInvoices = 0
  for (const e of entriesFor(ids)) {
    const ls = linesOf.all(e.id).filter(l => CODES.includes(l.code))
    console.log(`    ${e.date} ${e.entry_number} ${e.reference_type.padEnd(28)} ${e.description}`)
    for (const l of ls) console.log(`        ${l.code} ${l.debit ? 'Dr' : 'Cr'} ${fmt(l.debit || l.credit)}  ${l.description || ''}`)
    if (e.reference_type.startsWith('PURCHASE_INVOICE') || e.reference_type === 'PURCHASE_RETURN') {
      // ใบแจ้งหนี้รวมหลาย PO: แบ่งยอดที่ปิด 2109 ให้ PO นี้ตามสัดส่วนยอดตั้งของ GR ในใบ
      const pi = pis.find(p => p.id === e.reference_id)
      let share = 1
      if (pi) {
        let grIds = []
        try { grIds = JSON.parse(pi.goods_receipt_ids || '[]') } catch { grIds = [] }
        const accOf = gid => entriesFor([gid]).reduce((s, x) => s + net2109(x.id), 0)
        const total = grIds.reduce((s, g) => s + accOf(g), 0)
        const mine = grIds.filter(g => grs.some(x => x.id === g)).reduce((s, g) => s + accOf(g), 0)
        share = total > 0.005 ? mine / total : 1
        if (share < 0.999) console.log(`        (ใบรวมหลาย PO — นับให้ PO นี้ ${(share * 100).toFixed(1)}%)`)
      }
      clearedByInvoices += net2109(e.id) * share
    }
  }

  const residual = r2(accruedInvoiced + clearedByInvoices) // + = Cr ค้าง
  const openAccrual = r2(accruedAll - accruedInvoiced)
  const vatPart = r2(accruedAll - expectedAll)
  console.log(`  สรุป: 2109 ตั้งจาก GR ที่ออกบิลแล้ว ${fmt(accruedInvoiced)} · ใบแจ้งหนี้/ใบคืนปิดไป ${fmt(-clearedByInvoices)} · ค้าง ${fmt(residual)}`)
  console.log(`        ส่วนที่ GR ตั้งเกินต้นทุนจริง (VAT ในราคา) ${fmt(vatPart)} · ยังค้างถูกต้องเพราะ GR ยังไม่ออกบิล ${fmt(openAccrual)}`)
  // ไม่จด VAT + PO รวม VAT: GR ตั้ง 2109/1107 ที่ราคารวม VAT (ถูก) แต่ใบแจ้งหนี้รุ่นเก่าปิด 2109 แค่ยอดถอด VAT
  // แล้ว Dr 1107 "ภาษีซื้อที่ขอคืนไม่ได้" อีกรอบ → 2109 ค้างเท่า VAT ส่วนสต็อก และ 1107 นับ VAT สองครั้ง
  const rate = Number(po.tax_rate) || 0
  const vatInStock = rate ? r2(rawInvoiced * rate / (100 + rate)) : 0
  const why = !vatRegistered && po.vat_inclusive === 1 && Math.abs(residual - vatInStock) <= 0.05
    ? `กิจการไม่จด VAT + PO ราคารวม VAT: GR ตั้ง 2109/1107 รวม VAT แล้ว (${r2(vatInStock)}) แต่ใบแจ้งหนี้ปิด 2109 เฉพาะยอดถอด VAT แล้ว Dr 1107 ภาษีซื้อที่ขอคืนไม่ได้ซ้ำ — 1107 นับ VAT สองครั้ง`
    : !vatRegistered && po.vat_inclusive === 1
      ? `กิจการไม่จด VAT + PO ราคารวม VAT: VAT ถูกนับซ้ำใน 1107 (VAT ส่วนสต็อก ${r2(vatInStock)}) ปนกับบรรทัดไม่นับสต็อก/ราคาที่แก้ในบิล — ตรวจบรรทัดด้านบนก่อนลง`
    : Math.abs(residual - vatPart) <= 0.05
    ? 'ส่วน VAT ที่ GR ตั้งรวมไว้ใน 2109/1107 (PO ราคารวม VAT) ใบแจ้งหนี้ลง VAT ที่ 1110 แล้วจึงปิด 2109 ได้แค่ยอดถอด VAT'
    : Math.abs(residual - r2(po.discount_amount)) <= 0.05
      ? 'ส่วนลดท้ายบิลของ PO — GR ตั้งยอดก่อนหักส่วนลด ใบแจ้งหนี้ปิดได้แค่ยอดหลังหักส่วนลด'
      : 'ไม่ตรงกับ VAT/ส่วนลดพอดี — ราคาในใบแจ้งหนี้ต่ำกว่า PO หรือหลายสาเหตุปนกัน ตรวจบรรทัดด้านบนก่อนลง'
  if (Math.abs(residual) > 0.005) {
    proposals.push({ poNumber, residual, why })
  } else {
    console.log('  ไม่ต้องปรับปรุง')
  }
}

console.log('\n' + '='.repeat(100))
console.log('รายการปรับปรุงที่เสนอ (ยังไม่ได้ลงบัญชี — ลงผ่านสมุดรายวันทั่วไปในงวดที่ยังเปิดอยู่)')
let sum = 0
for (const p of proposals) {
  sum += p.residual
  if (p.residual > 0) {
    console.log(`  ${p.poNumber}: Dr 2109 ${fmt(p.residual)} / Cr 1107 ${fmt(p.residual)}`)
  } else {
    console.log(`  ${p.poNumber}: Dr 1107 ${fmt(-p.residual)} / Cr 2109 ${fmt(-p.residual)}`)
  }
  console.log(`      เหตุผล: ${p.why} — 1107 ในงบสูงเกินเท่ากัน (ทะเบียนสต็อก unit_cost ไม่ต้องแก้)`)
}
console.log(`  รวม ${fmt(sum)}`)
db.close()
