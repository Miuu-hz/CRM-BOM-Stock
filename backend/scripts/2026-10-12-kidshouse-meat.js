// Kids House Cafe — แทน "เนื้อสัตว์" (ING-MEAT แม่แบบตอนนำเข้าเมนู) ใน 23 สูตรด้วยเนื้อจริงตามที่เจ้าของยืนยัน 2026-10-12
// + สลัดไก่ 3 ตัวเลิกใช้ "ไก่เทอริยากิ" (ทำจากสะโพก + สูตรผลิตเป็น serving แต่สลัดใส่เป็น g → แปลงไม่ได้ → ติดสต็อก)
// + ปิดเมนู POS "สลัดรวม+แฮมชีส" (ปิด ไม่ลบ — บิลเก่ายังอ้างถึง)
// node scripts/2026-10-12-kidshouse-meat.js            dry-run
// node scripts/2026-10-12-kidshouse-meat.js --apply
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
const MEAT = item('ING-MEAT').id

// เมนู → { meat: null (ลบ) | [[sku, qty, unit], ...] (แทนที่), drop: [sku ที่ลบเพิ่ม], set: [[sku, qty]] (แก้จำนวน) }
const PLAN = {
  'FD-L005': { name: 'สลัดอกไก่ย่าง', meat: [['RAW-021', 80, 'g']], drop: ['ING-CHK'] },
  'FD-L010': { name: 'สลัดอกไก่ฉีก', meat: [['RAW-021', 80, 'g']], drop: ['ING-CHK'] },
  'FD-L003': { name: 'สลัดไก่กรอบ', meat: [['ING-CH01', 100, 'g'], ['ING-CRISPY-FLOUR', 20, 'g']], drop: ['ING-CHK'] },
  'FD-B001': { name: 'ข้าวกล่อง ยำไก่แซ่บ', meat: [['RAW-021', 100, 'g'], ['ING-CRISPY-FLOUR', 20, 'g']] },
  'FD-L008': { name: 'สลัดทูน่า', meat: null },
  'FD-L007': { name: 'ยำทูน่า', meat: null },
  'FD-L016': { name: 'สลัดทูน่าข้าวโพด', meat: [['ING-TNA', 50, 'g']] },
  'FD-L015': { name: 'สลัดทูน่าอะโวคาโด', meat: [['ING-TNA', 50, 'g']] },
  'FD-L004': { name: 'สลัดปูอัด', meat: null },
  'FD-M008': { name: 'สปาเกตตี้เบคอนผัดพริกแห้ง', meat: null },
  'FD-M012': { name: 'ข้าวกะเพรากุ้ง', meat: null, set: [['ING-SHR', 80]] },
  'FD-M022': { name: 'กะเพราปลาหมึก', meat: [['SKU-13378', 100, 'g']] },
  'FD-T001': { name: 'ยำทะเลรวม', meat: [['ING-SHR', 50, 'g']] },
  'FD-T024': { name: 'ยำวุ้นเส้นทะเล', meat: [['ING-SHR', 50, 'g']] },
  'FD-T021': { name: 'ยำวุ้นเส้นโบราณ', meat: [['ING-POG', 50, 'g'], ['RAW-20260818-026', 5, 'g']] },
  'FD-T002': { name: 'ยำมาม่า', meat: [['ING-POG', 50, 'g'], ['ING-PORK', 30, 'g']] },
  'FD-L019': { name: 'สลัดไข่ต้ม', meat: [['RAW-013', 1, 'pcs']] },
  'FD-L001': { name: 'ซีซ่าร์สลัด', meat: [['STK-ING-BAK-เบคอนกรอบ', 10, 'g']] },
  'FD-L011': { name: 'สลัดอะโวคาโด', meat: null },
  'FD-L009': { name: 'สลัดผลไม้', meat: null },
  'FD-L013': { name: 'สลัดรวมผลไม้', meat: null },
  'FD-L018': { name: 'สลัดเจ', meat: null },
  'FD-L017': { name: 'สลัดรวม+แฮมชีส', meat: null, disableMenu: true },
}

const ops = []
for (const [sku, p] of Object.entries(PLAN)) {
  const prod = item(sku)
  if (prod.name !== p.name) throw new Error(`${sku} ชื่อ "${prod.name}" ไม่ตรงกับที่คาด "${p.name}"`)
  const bom = db.prepare(`SELECT id FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`).get(T, prod.id)
  if (!bom) throw new Error(`${sku} ไม่มีสูตร ACTIVE`)
  const meatLine = db.prepare('SELECT id, quantity, unit, sort_order FROM bom_items WHERE bom_id = ? AND material_id = ?').get(bom.id, MEAT)
  const steps = []
  if (meatLine) {
    steps.push([`ลบ เนื้อสัตว์ ${meatLine.quantity}${meatLine.unit}`, () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(meatLine.id)])
    for (const [msku, q, u] of p.meat || []) {
      const m = item(msku)
      const existing = db.prepare('SELECT id, quantity FROM bom_items WHERE bom_id = ? AND material_id = ?').get(bom.id, m.id)
      if (existing) throw new Error(`${p.name} มี ${m.name} อยู่แล้ว (${existing.quantity}) — ตรวจด้วยมือ`)
      steps.push([`เพิ่ม ${m.name} ${q}${u}`, () => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, ?, NULL, ?, ?)`).run(crypto.randomBytes(12).toString('hex'), T, bom.id, m.id, q, meatLine.sort_order, u)])
    }
  }
  for (const dsku of p.drop || []) {
    const d = item(dsku)
    for (const l of db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bom.id, d.id)) steps.push([`ลบ ${d.name} ${l.quantity}${l.unit}`, () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(l.id)])
  }
  for (const [ssku, q] of p.set || []) {
    const s = item(ssku)
    for (const l of db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bom.id, s.id)) steps.push([`${s.name} ${l.quantity}${l.unit} → ${q}${l.unit}`, () => db.prepare('UPDATE bom_items SET quantity = ? WHERE id = ?').run(q, l.id)])
  }
  if (p.disableMenu) {
    const n = db.prepare('SELECT COUNT(*) n FROM pos_menu_configs WHERE tenant_id = ? AND product_id = ? AND (is_pos_enabled = 1 OR is_available = 1)').get(T, prod.id).n
    steps.push([`ปิดเมนู POS (${n} รายการ)`, () => db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, is_available = 0, updated_at = ? WHERE tenant_id = ? AND product_id = ?').run(now, T, prod.id)])
  }
  if (!steps.length) steps.push(['ไม่มีอะไรต้องแก้ (ทำไปแล้ว)', () => {}])
  ops.push({ title: `${p.name} [${sku}]`, steps })
}

console.log(`=== kidshouse-meat ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
ops.forEach((o, i) => console.log(`${String(i + 1).padStart(2)}. ${o.title}: ${o.steps.map(s => s[0]).join(' · ')}`))
console.log(`\nเหลือสูตรที่ยังใช้ เนื้อสัตว์ หลังรัน: ${db.prepare(`SELECT COUNT(*) n FROM bom_items bi JOIN boms b ON b.id = bi.bom_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).get(MEAT).n - ops.filter(o => o.steps.some(s => s[0].startsWith('ลบ เนื้อสัตว์'))).length}`)
if (!APPLY) { console.log('(dry-run — ยังไม่เขียนอะไร)'); process.exit(0) }

const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-meat-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o.steps.forEach(s => s[1]())))()
  console.log(`ลงจริงเสร็จ ${ops.length} เมนู`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
