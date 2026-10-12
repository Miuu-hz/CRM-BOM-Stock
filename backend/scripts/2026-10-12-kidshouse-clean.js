// Kids House Cafe — เก็บกวาดสูตร รอบ 2 (2026-10-12) ตามที่เจ้าของสั่ง
//  - "วุ้นเส้น/มาม่า" (ING-NOO ตัวแทน) ลบทุกสูตร; เมนูมาม่าใส่ ING-FF-NOODLE 1 ห่อ, บะหมี่ผักใส่ SKU-28946
//  - สลัดผลไม้/สลัดรวมผลไม้ ลบชาผลไม้ · สลัดทูน่าอะโวคาโด +อะโวคาโด 50 g
//  - กะเพรา 2 เมนู ลบชุดเครื่องปรุงที่ซ้ำ (sort_order >= 20) · ซีซ่าร์ ลบน้ำสลัดธรรมดา
// node scripts/2026-10-12-kidshouse-clean.js [--apply]
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const APPLY = process.argv.includes('--apply')
const db = new Database(path.join(__dirname, '..', 'dev.db'))
const T = 'tenant_bb_pillow'
const now = new Date().toISOString()
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
const lines = (bomId, matId) => db.prepare('SELECT id, quantity, unit, sort_order FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bomId, matId)
const add = (bomId, matId, q, u, sort) => () => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, ?, NULL, ?, ?)`).run(crypto.randomBytes(12).toString('hex'), T, bomId, matId, q, sort, u)
const del = (id) => () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(id)
const ops = [] // [menu, desc, fn]

// 1) วุ้นเส้น/มาม่า
const NOO = item('ING-NOO'), MAMA = item('ING-FF-NOODLE'), VEGNOODLE = item('SKU-28946')
const REPLACE = {
  'FD-T002': [MAMA, 1, MAMA.base_unit], 'FD-T014': [MAMA, 1, MAMA.base_unit], 'FD-T004': [MAMA, 1, MAMA.base_unit],
  'FD-M014': [VEGNOODLE, 100, 'g'], 'FD-M015': [VEGNOODLE, 80, 'g'],
}
for (const b of db.prepare(`SELECT DISTINCT b.id, p.sku, p.name FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE' ORDER BY p.name`).all(NOO.id)) {
  for (const l of lines(b.id, NOO.id)) {
    ops.push([b.name, `ลบ วุ้นเส้น/มาม่า ${l.quantity}${l.unit}`, del(l.id)])
    const r = REPLACE[b.sku]
    if (r) {
      if (lines(b.id, r[0].id).length) throw new Error(`${b.name} มี ${r[0].name} อยู่แล้ว`)
      ops.push([b.name, `เพิ่ม ${r[0].name} ${r[1]} ${r[2]}`, add(b.id, r[0].id, r[1], r[2], l.sort_order)])
    }
  }
}

// 2) สลัดผลไม้: ลบชาผลไม้
const FRT = item('ING-FRT')
for (const sku of ['FD-L009', 'FD-L013']) {
  const { bomId, name } = bomOf(sku)
  for (const l of lines(bomId, FRT.id)) ops.push([name, `ลบ ชาผลไม้ ${l.quantity}${l.unit}`, del(l.id)])
}

// 3) สลัดทูน่าอะโวคาโด +อะโวคาโด 50 g
{
  const { bomId, name } = bomOf('FD-L015'), AVO = item('ING-AVO')
  if (!lines(bomId, AVO.id).length) ops.push([name, 'เพิ่ม อะโวคาโด 50g', add(bomId, AVO.id, 50, 'g', 3)])
}

// 4) กะเพรา: เก็บชุดแรก ลบชุดที่ซ้ำ (บรรทัดที่วัตถุดิบเดียวกันโผล่ซ้ำ — ลบตัวที่ sort_order มากกว่า)
for (const sku of ['FD-M022', 'FD-M012']) {
  const { bomId, name } = bomOf(sku)
  const all = db.prepare(`SELECT bi.id, bi.material_id, bi.quantity, bi.unit, bi.sort_order, si.name FROM bom_items bi JOIN stock_items si ON si.id = bi.material_id WHERE bi.bom_id = ? ORDER BY bi.sort_order, bi.rowid`).all(bomId)
  const seen = new Set()
  for (const l of all) {
    if (seen.has(l.material_id)) ops.push([name, `ลบ ${l.name} ${l.quantity}${l.unit} (ซ้ำ)`, del(l.id)])
    seen.add(l.material_id)
  }
}

// 5) ซีซ่าร์: น้ำสลัดซีซ่าร์อย่างเดียว
{
  const { bomId, name } = bomOf('FD-L001'), DRE = item('ING-DRE')
  for (const l of lines(bomId, DRE.id)) ops.push([name, `ลบ น้ำสลัด ${l.quantity}${l.unit}`, del(l.id)])
}

// 6) ลบ "ชุดปั้นปูนปลาสเตอร์" และ "เครื่องเคียงสเต็ก" ออกจากทุกสูตร (คง SKU ไว้)
for (const nm of ['เครื่องเคียงสเต็ก']) { // ชุดปั้นปูน: เมนูกิจกรรมมีแค่บรรทัดนี้ ลบแล้วสูตรว่าง → POS ตัดตัวเมนูเองแทน (สต็อก 0) รอเจ้าของเลือกทาง
  const ids = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND name = ? AND status != 'INACTIVE'`).all(T, nm)
  if (!ids.length) throw new Error(`ไม่พบ ${nm}`)
  for (const { id } of ids) {
    for (const l of db.prepare(`SELECT bi.id, bi.quantity, bi.unit, p.name menu FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).all(id)) {
      ops.push([l.menu, `ลบ ${nm} ${l.quantity}${l.unit}`, del(l.id)])
    }
  }
}

// 7) เมนูกิจกรรม "แต่งหน้าเค้ก DIY" / "ปูนปลาสเตอร์" — เจ้าของสั่งเอาออก: ปิดเมนู POS + ปิดสูตร + ปิดสินค้า (ไม่ลบ บิลเก่ายังอ้างถึง)
for (const sku of ['OT-C001', 'OT-C004']) {
  const p = item(sku)
  const moves = db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE stock_item_id = ?').get(p.id).n
  ops.push([p.name, `ปิดเมนู POS + ปิดสูตร + ปิดสินค้า (เคลื่อนไหว ${moves})`, () => {
    db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, is_available = 0, updated_at = ? WHERE tenant_id = ? AND product_id = ?').run(now, T, p.id)
    db.prepare(`UPDATE boms SET status = 'INACTIVE', updated_at = ? WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).run(now, T, p.id)
    db.prepare(`UPDATE stock_items SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, p.id)
  }])
}

console.log(`=== kidshouse-clean ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
const byMenu = {}
for (const [m, d] of ops) (byMenu[m] = byMenu[m] || []).push(d)
Object.entries(byMenu).forEach(([m, ds], i) => console.log(`${String(i + 1).padStart(2)}. ${m}: ${ds.join(' · ')}`))
console.log(`\nบะหมี่ผัก SKU-28946: base ${VEGNOODLE.base_unit}, display ${VEGNOODLE.display_unit}, qty ${VEGNOODLE.quantity}, sealed ${VEGNOODLE.sealed_qty}, กฎ: ${JSON.stringify(db.prepare('SELECT from_unit, to_unit, conversion_factor FROM unit_conversions WHERE material_id = ?').all(VEGNOODLE.id))}`)
console.log(`มาม่า ING-FF-NOODLE: base ${MAMA.base_unit}, qty ${MAMA.quantity}`)
if (!APPLY) { console.log('(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }

const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-clean-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o[2]()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
