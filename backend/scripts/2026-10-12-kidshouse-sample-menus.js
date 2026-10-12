// Kids House Cafe — ปิดเมนูตัวอย่างตอนตั้งระบบ (DRINK-00x/FOOD-00x ขายแค่บิลทดสอบที่ยกเลิกแล้ว) + เมนูที่เจ้าของสั่งปิด
// แล้วปิด SKU วัตถุดิบที่เหลือใช้แค่ในเมนูที่ปิด และไม่มีของ/ประวัติ (2026-10-12)
// node scripts/2026-10-12-kidshouse-sample-menus.js [--apply]
const path = require('path')
const Database = require('better-sqlite3')
const APPLY = process.argv.includes('--apply')
const db = new Database(path.join(__dirname, '..', 'dev.db'))
const T = 'tenant_bb_pillow'
const now = new Date().toISOString()

const MENUS = [
  'DRINK-001', 'DRINK-002', 'DRINK-003', 'DRINK-004', 'DRINK-005', 'DRINK-006', 'DRINK-007',
  'FOOD-001', 'FOOD-002', 'FOOD-003', 'FOOD-005', 'FOOD-006', 'FOOD-007', // FOOD-004 ข้าวผัดไก่ คงไว้
  'DR-A005',  // Hoegaarden
  'SB-W018',  // แซนวิชอะโวคาโดไข่ม้วน
  'FD-M016',  // ผัดซีอิ้วหมู
]
const ops = []
const disabledIds = new Set()
for (const sku of MENUS) {
  const p = db.prepare('SELECT id, name FROM stock_items WHERE tenant_id = ? AND sku = ?').get(T, sku)
  if (!p) throw new Error(`ไม่พบ ${sku}`)
  const realSales = db.prepare(`SELECT COUNT(*) n FROM pos_bill_items bi JOIN pos_menu_configs pmc ON pmc.id = bi.pos_menu_id JOIN pos_running_bills b ON b.id = bi.bill_id WHERE pmc.product_id = ? AND b.status NOT IN ('CANCELLED','VOID')`).get(p.id).n
  disabledIds.add(p.id)
  ops.push([`ปิดเมนู ${sku} ${p.name}${realSales ? ` ⚠️ มีบิลจริง ${realSales}` : ''}`, () => {
    db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, is_available = 0, updated_at = ? WHERE tenant_id = ? AND product_id = ?').run(now, T, p.id)
    db.prepare(`UPDATE boms SET status = 'INACTIVE', updated_at = ? WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).run(now, T, p.id)
    db.prepare(`UPDATE stock_items SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, p.id)
  }])
}

// วัตถุดิบที่ทุกสูตร ACTIVE ที่ใช้มันเป็นเมนูที่กำลังปิด + ไม่มีประวัติเคลื่อนไหว + ไม่เคยรับเข้า
const mats = db.prepare(`
  SELECT DISTINCT si.id, si.sku, si.name, si.quantity FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items si ON si.id = bi.material_id
  WHERE b.tenant_id = ? AND b.status = 'ACTIVE' AND b.product_id IN (${[...disabledIds].map(() => '?').join(',')}) AND si.status != 'INACTIVE'`).all(T, ...disabledIds)
for (const m of mats) {
  const otherUse = db.prepare(`SELECT COUNT(*) n FROM bom_items bi JOIN boms b ON b.id = bi.bom_id WHERE bi.material_id = ? AND b.status = 'ACTIVE' AND b.product_id NOT IN (${[...disabledIds].map(() => '?').join(',')})`).get(m.id, ...disabledIds).n
  const moves = db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE stock_item_id = ?').get(m.id).n
  if (otherUse || moves) continue
  ops.push([`ปิด SKU ${m.sku} ${m.name} (qty ${m.quantity}, ไม่มีประวัติ, ใช้แค่ในเมนูที่ปิด)`, () => db.prepare(`UPDATE stock_items SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, m.id)])
}

console.log(`=== kidshouse-sample-menus ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
ops.forEach(([d], i) => console.log(`${String(i + 1).padStart(2)}. ${d}`))
if (!APPLY) { console.log('(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }
const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-sample-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o[1]()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
