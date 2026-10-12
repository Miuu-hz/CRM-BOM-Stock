// Kids House Cafe — แซนวิชรอบสุดท้าย (2026-10-12): ไข่ 50 ฟอง → 2/1, มายองเนส, ปิดเมนูที่เจ้าของสั่ง
// node scripts/2026-10-12-kidshouse-sandwich.js [--apply]
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const APPLY = process.argv.includes('--apply')
const db = new Database(path.join(__dirname, '..', 'dev.db'))
const T = 'tenant_bb_pillow'
const now = new Date().toISOString()
const hex = () => crypto.randomBytes(12).toString('hex')
const item = (sku) => {
  const r = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ? AND sku = ?').get(T, sku)
  if (!r) throw new Error(`ไม่พบ SKU ${sku}`)
  return r
}
const bomOf = (sku) => {
  const p = item(sku)
  const b = db.prepare(`SELECT id FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`).get(T, p.id)
  if (!b) throw new Error(`${sku} ไม่มีสูตร ACTIVE`)
  return { bomId: b.id, name: p.name }
}
const ops = []

// 1) ไข่: แซนวิชเกาหลี 2 ฟอง, แซนวิช (ปังโฮลวีท) 1 ฟอง
const EGG = item('RAW-013')
for (const [sku, n] of [['SB-W003', 2], ['SB-W004', 1]]) {
  const { bomId, name } = bomOf(sku)
  const ls = db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bomId, EGG.id)
  if (ls.length !== 1) throw new Error(`${name}: คาดว่ามีไข่ 1 บรรทัด เจอ ${ls.length}`)
  ops.push([name, `ไข่ไก่ ${ls[0].quantity}${ls[0].unit} → ${n} pcs`, () => db.prepare(`UPDATE bom_items SET quantity = ?, unit = 'pcs' WHERE id = ?`).run(n, ls[0].id)])
}

// 2) มายองเนส: คิวพี (ING-MAYONNAISE) หน่วยเก็บ ถุง → g, ย้ายตัวซ้ำ STK-ING-MYN มาที่ตัวนี้, เพิ่ม 20 g ในแซนวิชปูอัดมายองเนส
const MAYO = item('ING-MAYONNAISE'), DUP = item('STK-ING-MYN')
if (MAYO.base_unit !== 'g') {
  ops.push(['มายองเนสคิวพี', `หน่วยเก็บ ${MAYO.base_unit} → g: qty ${MAYO.quantity} → ${MAYO.quantity * 1000}, ทุน ${MAYO.unit_cost} → ${MAYO.unit_cost / 1000}/g, กฎ 1 ถุง/bag = 1000 g`, () => {
    db.prepare(`UPDATE stock_items SET base_unit = 'g', unit = 'g', display_unit = 'ถุง', quantity = quantity * 1000, unit_cost = unit_cost / 1000, updated_at = ? WHERE id = ?`).run(now, MAYO.id)
    for (const u of ['ถุง', 'bag']) if (!db.prepare('SELECT 1 FROM unit_conversions WHERE material_id = ? AND from_unit = ? AND to_unit = ?').get(MAYO.id, u, 'g'))
      db.prepare(`INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'g', 1000, 0, ?, ?, ?)`).run(hex(), T, MAYO.id, u, 'คิวพี มายองเนส 1 กก./ถุง (2026-10-12)', now, now)
  }])
}
{
  const moves = db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE stock_item_id = ?').get(DUP.id).n
  if (Number(DUP.quantity) !== 0 || moves) throw new Error('STK-ING-MYN มีสต็อก/ประวัติ — ต้องรวมยอดด้วย')
  const used = db.prepare(`SELECT p.name, bi.quantity, bi.unit FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).all(DUP.id)
  ops.push(['มายองเนส (ซ้ำ)', `STK-ING-MYN → ING-MAYONNAISE ในสูตร: ${used.map(u => `${u.name} ${u.quantity}${u.unit}`).join(', ') || '-'}; ปิด STK-ING-MYN`, () => {
    db.prepare('UPDATE bom_items SET material_id = ? WHERE material_id = ?').run(MAYO.id, DUP.id)
    db.prepare('UPDATE pos_menu_ingredients SET stock_item_id = ? WHERE stock_item_id = ?').run(MAYO.id, DUP.id)
    db.prepare(`UPDATE stock_items SET status = 'INACTIVE', name = ?, updated_at = ? WHERE id = ?`).run(`${DUP.name} (ซ้ำ - รวมเข้า ${MAYO.name} แล้ว)`, now, DUP.id)
  }])
}
{
  const { bomId, name } = bomOf('SB-W026')
  if (db.prepare('SELECT 1 FROM bom_items WHERE bom_id = ? AND material_id IN (?, ?)').get(bomId, MAYO.id, DUP.id)) throw new Error(`${name} มีมายองเนสอยู่แล้ว`)
  ops.push([name, 'เพิ่ม มายองเนส 20g', () => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, 20, NULL, 50, 'g')`).run(hex(), T, bomId, MAYO.id)])
}

// ไก่ซอสมะนาว: มายองเนสใช้จริง ~60 g (เดิม 100 g) — ต้องรันหลังย้าย STK-ING-MYN → ING-MAYONNAISE
{
  const p = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND name = 'ไก่ซอสมะนาว' AND status != 'INACTIVE'`).get(T)
  const b = db.prepare(`SELECT id FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).get(T, p.id)
  const l = db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id IN (?, ?)').get(b.id, MAYO.id, DUP.id)
  if (!l) throw new Error('ไก่ซอสมะนาวไม่มีมายองเนสในสูตร')
  ops.push(['ไก่ซอสมะนาว', `มายองเนส ${l.quantity}${l.unit} → 60g`, () => db.prepare(`UPDATE bom_items SET quantity = 60, unit = 'g' WHERE id = ?`).run(l.id)])
}

// 3) ปิดเมนู: แซนวิชอะโวกล้วยหอม, แซนวิช 1เซต, แซนวิช+โรล
for (const sku of ['SB-W030', 'SB-W001', 'SB-W016']) {
  const p = item(sku)
  ops.push([p.name, 'ปิดเมนู POS + ปิดสูตร + ปิดสินค้า', () => {
    db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, is_available = 0, updated_at = ? WHERE tenant_id = ? AND product_id = ?').run(now, T, p.id)
    db.prepare(`UPDATE boms SET status = 'INACTIVE', updated_at = ? WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).run(now, T, p.id)
    db.prepare(`UPDATE stock_items SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, p.id)
  }])
}

console.log(`=== kidshouse-sandwich ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
ops.forEach(([m, d], i) => console.log(`${i + 1}. ${m}: ${d}`))
if (!APPLY) { console.log('(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }
const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-sandwich-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o[2]()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
