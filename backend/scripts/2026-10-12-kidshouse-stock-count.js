// Kids House Cafe — ของที่มีอยู่จริงแต่ไม่เคยรับเข้าผ่านใบ (2026-10-12) + แก้สูตรเบคอนในคาโบนาร่า
// ปรับยอดผ่าน applyStockMovement (ตัวเดียวกับหน้าเว็บ) → มีทะเบียนการปรับสต็อก/stock_movements ครบ
// ยังไม่มีทุน → มูลค่าปรับ = 0 ใส่ทุนภายหลังได้
// node scripts/2026-10-12-kidshouse-stock-count.js            dry-run
// node scripts/2026-10-12-kidshouse-stock-count.js --apply
const path = require('path')
const crypto = require('crypto')
const APPLY = process.argv.includes('--apply')
const db = require(path.join(__dirname, '..', 'dist', 'db', 'sqlite.js')).default
const { applyStockMovement } = require(path.join(__dirname, '..', 'dist', 'services', 'stockMovement.service.js'))
const T = 'tenant_bb_pillow'
const BY = 'system:kidshouse-stock-count'
const BOM_CARBONARA = '3895df58e35c40f7944a45077'

const COUNTS = [
  ['ING-CHEDDAR', 100, 'g'],
  ['STK-ING-PER-พริกไทยบด', 200, 'g'],
  ['STK-ING-BAK-เบคอนกรอบ', 200, 'g'],
  ['STK-ING-PMC', 100, 'g'],
  ['ING-STR', 200, 'ml'],
]
const item = (sku) => {
  const r = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ? AND sku = ?').get(T, sku)
  if (!r) throw new Error(`ไม่พบ SKU ${sku}`)
  return r
}

const ops = []
for (const [sku, qty, unit] of COUNTS) {
  const s = item(sku)
  if (s.base_unit !== unit) throw new Error(`${sku} หน่วยเก็บ ${s.base_unit} ไม่ใช่ ${unit}`)
  if (Number(s.quantity) === qty) { ops.push({ desc: `${s.name}: ${qty} ${unit} อยู่แล้ว — ข้าม`, run: () => {} }); continue }
  ops.push({
    desc: `${s.name}: ${s.quantity} → ${qty} ${unit} (ทุนปัจจุบัน ${s.unit_cost || 0})`,
    run: () => applyStockMovement(T, BY, { stockItemId: s.id, type: 'ADJUST', quantity: qty, unit, reference: 'นับสต็อก 12/10/26', notes: 'ของมีอยู่จริงแต่ไม่เคยรับเข้าผ่านใบ', adjustReason: 'รับเพิ่มไม่ผ่านใบ' }),
  })
}

// คาโบนาร่า: เบคอนกรอบ 10 g (โรยหน้า) + เบคอนหั่น 60 g
const crispy = item('STK-ING-BAK-เบคอนกรอบ'), bacon = item('ING-BAC')
for (const l of db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id = ?').all(BOM_CARBONARA, crispy.id)) {
  if (Number(l.quantity) !== 10) ops.push({ desc: `คาโบนาร่า: เบคอนกรอบ ${l.quantity}${l.unit} → 10g`, run: () => db.prepare(`UPDATE bom_items SET quantity = 10, unit = 'g' WHERE id = ?`).run(l.id) })
}
if (!db.prepare('SELECT 1 FROM bom_items WHERE bom_id = ? AND material_id = ?').get(BOM_CARBONARA, bacon.id)) {
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM bom_items WHERE bom_id = ?').get(BOM_CARBONARA).n
  ops.push({ desc: `คาโบนาร่า: เพิ่ม ${bacon.name} (ING-BAC) 60g`, run: () => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, 60, NULL, ?, 'g')`).run(crypto.randomBytes(12).toString('hex'), T, BOM_CARBONARA, bacon.id, sort) })
}

console.log(`=== kidshouse-stock-count ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
ops.forEach((o, i) => console.log(`${i + 1}. ${o.desc}`))
if (!APPLY) { console.log('\n(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }

const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-count-${new Date().toISOString().replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o.run()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
