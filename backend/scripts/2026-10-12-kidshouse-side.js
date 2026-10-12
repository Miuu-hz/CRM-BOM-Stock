// Kids House Cafe — "เครื่องเคียงตามเมนู" (ING-MIX ตัวแทน) ลบออกทุกสูตร + แก้ส้มตำ/แซนวิชตามที่เจ้าของยืนยัน (2026-10-12)
// node scripts/2026-10-12-kidshouse-side.js [--apply]
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
  return { bomId: b.id, name: p.name, prodId: p.id }
}
const lines = (bomId, matId) => db.prepare('SELECT id, quantity, unit, sort_order FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bomId, matId)
const ops = [] // [menu, desc, fn]
const addLine = (sku, matId, matName, q, u) => {
  const { bomId, name } = bomOf(sku)
  if (lines(bomId, matId).length) throw new Error(`${name} มี ${matName} อยู่แล้ว — ตรวจด้วยมือ`)
  ops.push([name, `เพิ่ม ${matName} ${q}${u}`, () => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, ?, NULL, 50, ?)`).run(hex(), T, bomId, matId, q, u)])
}
const replaceLine = (sku, fromSku, toId, toName, q, u) => {
  const { bomId, name } = bomOf(sku)
  const from = item(fromSku)
  const ls = lines(bomId, from.id)
  if (!ls.length) throw new Error(`${name} ไม่มี ${from.name}`)
  for (const l of ls) ops.push([name, `${from.name} ${l.quantity}${l.unit} → ${toName} ${q}${u}`, () => db.prepare('UPDATE bom_items SET material_id = ?, quantity = ?, unit = ? WHERE id = ?').run(toId, q, u, l.id)])
}
const disableMenu = (sku) => {
  const p = item(sku)
  ops.push([p.name, 'ปิดเมนู POS + ปิดสูตร + ปิดสินค้า', () => {
    db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, is_available = 0, updated_at = ? WHERE tenant_id = ? AND product_id = ?').run(now, T, p.id)
    db.prepare(`UPDATE boms SET status = 'INACTIVE', updated_at = ? WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).run(now, T, p.id)
    db.prepare(`UPDATE stock_items SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, p.id)
  }])
}

// 1) ลบ "เครื่องเคียงตามเมนู" ทุกสูตร
const MIX = item('ING-MIX')
for (const l of db.prepare(`SELECT bi.id, bi.quantity, bi.unit, p.name menu FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE' ORDER BY p.sku`).all(MIX.id)) {
  ops.push([l.menu, `ลบ เครื่องเคียงตามเมนู ${l.quantity}${l.unit}`, () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(l.id)])
}

// 2) ส้มตำ
disableMenu('FD-T017') // ตำไทยไข่เค็ม
disableMenu('FD-T018') // ตำคอหมูย่าง
const CORN = item('ING-55154')
replaceLine('FD-T015', 'ING-CRN', CORN.id, CORN.name, 300, 'g') // ตำข้าวโพด: คอนเฟลก → ข้าวโพด 1 ฝัก ≈ 300 g (ซื้อทั้งฝักเป็นกิโล)
replaceLine('FD-T016', 'ING-CRN', CORN.id, CORN.name, 300, 'g')
const SHR = item('ING-SHR')
addLine('FD-T003', SHR.id, SHR.name, 50, 'g') // ตำป่ากุ้งสะดุ้ง

// ปูดอง: SKU ใหม่ (คัดลอกโครงจาก ปูอัด วัตถุดิบหน่วย g)
let crabId = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND sku = 'ING-PICKLED-CRAB'`).get(T)?.id
if (!crabId) {
  crabId = hex()
  const tpl = item('ING-CRB')
  const row = { ...tpl, id: crabId, sku: 'ING-PICKLED-CRAB', name: 'ปูดอง', quantity: 0, sealed_qty: 0, unit_cost: 0, status: 'ACTIVE', created_at: now, updated_at: now }
  for (const c of ['purchase_price', 'purchase_unit', 'barcode', 'image_url', 'description', 'min_stock', 'max_stock']) if (c in row) row[c] = null
  const keys = Object.keys(row)
  ops.push(['(SKU ใหม่)', `สร้าง ING-PICKLED-CRAB "ปูดอง" หน่วย ${tpl.base_unit} สต็อก 0`, () => db.prepare(`INSERT INTO stock_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]))])
}
replaceLine('FD-T025', 'ING-CRB', crabId, 'ปูดอง', 15, 'g') // ตำปูปลาร้า: ปูอัด 1 g → ปูดอง 15 g

// เส้นเล็ก: หน่วยเก็บ ถุง → g (ถุงละ 1 กก.) แล้วใส่ตำเส้นเล็ก 100 g
const NOODLE = item('ING-NOODLE-RICE')
if (NOODLE.base_unit !== 'g') {
  ops.push(['เส้นเล็ก ING-NOODLE-RICE', `หน่วยเก็บ ${NOODLE.base_unit} → g: qty ${NOODLE.quantity} → ${NOODLE.quantity * 1000}, ทุน ${NOODLE.unit_cost} → ${NOODLE.unit_cost / 1000}/g, กฎ 1 ถุง/bag = 1000 g`, () => {
    db.prepare(`UPDATE stock_items SET base_unit = 'g', unit = 'g', display_unit = 'ถุง', quantity = quantity * 1000, unit_cost = unit_cost / 1000, updated_at = ? WHERE id = ?`).run(now, NOODLE.id)
    for (const u of ['ถุง', 'bag']) {
      if (!db.prepare('SELECT 1 FROM unit_conversions WHERE material_id = ? AND from_unit = ? AND to_unit = ?').get(NOODLE.id, u, 'g'))
        db.prepare(`INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'g', 1000, 0, ?, ?, ?)`).run(hex(), T, NOODLE.id, u, 'เส้นเล็ก 1 กก./ถุง (2026-10-12)', now, now)
    }
  }])
}
addLine('FD-T026', NOODLE.id, 'เส้นเล็ก', 100, 'g')

// 3) แซนวิช (ไส้ตามชื่อเมนู ข้อ ✅)
const EGG = item('RAW-013'), BREAST = item('RAW-021'), TUNA = item('ING-TNA'), AVO = item('ING-AVO')
for (const sku of ['SB-W006', 'SB-W015', 'SB-W021', 'SB-W023']) addLine(sku, EGG.id, 'ไข่ไก่', 1, 'pcs')
addLine('SB-W020', EGG.id, 'ไข่ไก่', 2, 'pcs')
addLine('SB-W012', BREAST.id, 'อกไก่', 50, 'g')
addLine('SB-W031', TUNA.id, 'ทูน่า', 50, 'g'); addLine('SB-W031', EGG.id, 'ไข่ไก่', 1, 'pcs')
addLine('SB-W029', TUNA.id, 'ทูน่า', 50, 'g'); addLine('SB-W029', AVO.id, 'อะโวคาโด', 50, 'g')

console.log(`=== kidshouse-side ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
const byMenu = {}
for (const [m, d] of ops) (byMenu[m] = byMenu[m] || []).push(d)
Object.entries(byMenu).forEach(([m, ds], i) => console.log(`${String(i + 1).padStart(2)}. ${m}: ${ds.join(' · ')}`))
if (!APPLY) { console.log('(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }

const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-side-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o[2]()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
