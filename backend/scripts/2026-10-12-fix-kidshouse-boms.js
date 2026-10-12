// Kids House Cafe (tenant_bb_pillow) — สูตรเมนูชี้ SKU ผิดตัว ทำให้ POS ชำระบิลไม่ได้ (2026-10-12)
//   1) น้ำดื่มสิงห์ DR-O001 = ของขาย แต่มีสูตรไปตัด ING-WTR (น้ำเปล่าทำอาหาร) → ปิดสูตร ให้ขายแล้วตัดตัวเอง
//   2) ING-OIL ซ้ำกับ RAW-024 (ของจริงอยู่ RAW-024) → ย้ายบรรทัดสูตร + ปิด ING-OIL
//   3) แป้งที่ร้านใช้จริง = ING-CRISPY-FLOUR (เก็บเป็น "ถุง") → หน่วยเก็บเป็น g + กฎ ถุง→g 1000
//   4) STK-ING-WTF / STK-ING-WHF (แป้งสาลีที่ไม่เคยซื้อ) → ย้ายบรรทัดสูตรไป ING-CRISPY-FLOUR + ปิด
//
// node scripts/2026-10-12-fix-kidshouse-boms.js            dry-run
// node scripts/2026-10-12-fix-kidshouse-boms.js --apply    backup ด้วย db.backup() แล้วลงใน transaction เดียว
// ponytail: สคริปต์ครั้งเดียวสำหรับ tenant เดียว ไม่ใช่ฟีเจอร์รวม SKU — ถ้าต้องรวมบ่อยค่อยทำเป็นหน้าจอ

const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const APPLY = process.argv.includes('--apply')
const DB_PATH = path.join(__dirname, '..', 'dev.db')
const T = 'tenant_bb_pillow'
const db = new Database(DB_PATH)

const item = (sku) => {
  const r = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ? AND sku = ?').get(T, sku)
  if (!r) throw new Error(`ไม่พบ SKU ${sku}`)
  return r
}
const cols = new Set(db.prepare('PRAGMA table_info(stock_items)').all().map(c => c.name))
const now = new Date().toISOString()
const ops = [] // { desc, run }

// 1) ปิดสูตรของน้ำดื่มสิงห์
const singha = item('DR-O001')
const singhaBoms = db.prepare(`SELECT id, version AS bom_number FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).all(T, singha.id)
const menusPinned = db.prepare(`SELECT COUNT(*) n FROM pos_menu_configs WHERE tenant_id = ? AND bom_id IN (${singhaBoms.map(() => '?').join(',') || "''"})`).get(T, ...singhaBoms.map(b => b.id)).n
for (const b of singhaBoms) {
  const lines = db.prepare(`SELECT si.sku, bi.quantity, bi.unit FROM bom_items bi JOIN stock_items si ON si.id = bi.material_id WHERE bi.bom_id = ?`).all(b.id)
  ops.push({ desc: `ปิดสูตร ${b.bom_number || b.id} ของ DR-O001 (บรรทัด: ${lines.map(l => `${l.sku} ${l.quantity}${l.unit}`).join(', ')})`, run: () => db.prepare(`UPDATE boms SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(now, b.id) })
}
if (menusPinned) ops.push({ desc: `เมนู POS ${menusPinned} ตัวที่ล็อก bom_id ของ DR-O001 ไว้ → ล้าง bom_id`, run: () => db.prepare(`UPDATE pos_menu_configs SET bom_id = NULL, updated_at = ? WHERE tenant_id = ? AND bom_id IN (${singhaBoms.map(() => '?').join(',')})`).run(now, T, ...singhaBoms.map(b => b.id)) })

// ย้ายบรรทัดสูตร (bom_items + pos_menu_ingredients) จาก SKU ซ้ำไป SKU จริง แล้วปิด SKU ซ้ำ
function repoint(fromSku, toSku) {
  const from = item(fromSku), to = item(toSku)
  const boms = db.prepare(`SELECT p.name, bi.quantity, bi.unit FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).all(from.id)
  const menuIng = db.prepare(`SELECT COUNT(*) n FROM pos_menu_ingredients WHERE stock_item_id = ?`).get(from.id).n
  const moves = db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE stock_item_id = ?`).get(from.id).n
  if (Number(from.quantity) !== 0 || Number(from.sealed_qty || 0) !== 0 || moves > 0) {
    throw new Error(`${fromSku} ยังมีสต็อก/ประวัติเคลื่อนไหว (qty=${from.quantity}, moves=${moves}) — ต้องรวมยอดด้วย สคริปต์นี้ไม่ทำ`)
  }
  ops.push({
    desc: `${fromSku} → ${toSku}: สูตร ${boms.length} (${boms.map(b => `${b.name} ${b.quantity}${b.unit}`).join(' | ') || '-'}), เมนู POS ${menuIng}; ปิด ${fromSku}`,
    run: () => {
      db.prepare('UPDATE bom_items SET material_id = ? WHERE material_id = ?').run(to.id, from.id)
      db.prepare('UPDATE pos_menu_ingredients SET stock_item_id = ? WHERE stock_item_id = ?').run(to.id, from.id)
      db.prepare(`UPDATE stock_items SET status = 'INACTIVE', name = ?, updated_at = ? WHERE id = ?`)
        .run(`${from.name} (ซ้ำ - รวมเข้า ${to.name} แล้ว)`, now, from.id)
    },
  })
}

// 2) น้ำมันพืช
repoint('ING-OIL', 'RAW-024')

// 3) แป้งทอดกรอบ: ถุง → g
const flour = item('ING-CRISPY-FLOUR')
const FACTOR = 1000
if (flour.base_unit === 'g') {
  ops.push({ desc: 'ING-CRISPY-FLOUR หน่วยเก็บเป็น g อยู่แล้ว — ข้าม', run: () => {} })
} else {
  const scaleCols = ['min_stock', 'max_stock', 'reorder_point', 'reorder_qty', 'reorder_level'].filter(c => cols.has(c) && flour[c] != null && Number(flour[c]) !== 0)
  ops.push({
    desc: `ING-CRISPY-FLOUR หน่วยเก็บ ${flour.base_unit} → g: qty ${flour.quantity} → ${flour.quantity * FACTOR}, ทุน ${flour.unit_cost} → ${flour.unit_cost / FACTOR}/g` +
      (scaleCols.length ? `, ${scaleCols.map(c => `${c} ${flour[c]}→${flour[c] * FACTOR}`).join(', ')}` : '') + `, display_unit = ถุง`,
    run: () => {
      db.prepare(`UPDATE stock_items SET base_unit = 'g', unit = 'g', display_unit = 'ถุง', quantity = quantity * ?, unit_cost = unit_cost / ?, updated_at = ?${scaleCols.map(c => `, ${c} = ${c} * ${FACTOR}`).join('')} WHERE id = ?`)
        .run(FACTOR, FACTOR, now, flour.id)
    },
  })
  for (const u of ['ถุง', 'bag']) {
    const has = db.prepare('SELECT 1 FROM unit_conversions WHERE material_id = ? AND from_unit = ? AND to_unit = ?').get(flour.id, u, 'g')
    if (!has) ops.push({
      desc: `กฎหน่วยรายสินค้า ING-CRISPY-FLOUR: 1 ${u} = ${FACTOR} g`,
      run: () => db.prepare(`INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'g', ?, 0, ?, ?, ?)`)
        .run(crypto.randomBytes(12).toString('hex'), T, flour.id, u, FACTOR, 'แป้งทอดกรอบ 1 กก./ถุง (2026-10-12)', now, now),
    })
  }
}

// 4) แป้งสาลีที่ไม่เคยซื้อ
repoint('STK-ING-WTF', 'ING-CRISPY-FLOUR')
repoint('STK-ING-WHF', 'ING-CRISPY-FLOUR')

// 5) พริกไทย: ตัดคำว่า "บด" ออก + สูตรใช้จริงแค่ 1–2 g ต่อจาน (เดิมตั้งไว้ 5 g)
const pepper = item('STK-ING-PER-พริกไทยบด')
if (pepper.name !== 'พริกไทย') ops.push({ desc: `เปลี่ยนชื่อ "${pepper.name}" → "พริกไทย"`, run: () => db.prepare('UPDATE stock_items SET name = ?, updated_at = ? WHERE id = ?').run('พริกไทย', now, pepper.id) })
for (const l of db.prepare(`SELECT bi.id, p.name, bi.quantity, bi.unit FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).all(pepper.id)) {
  if (Number(l.quantity) > 2) ops.push({ desc: `สูตร ${l.name}: พริกไทย ${l.quantity}${l.unit} → 2${l.unit}`, run: () => db.prepare('UPDATE bom_items SET quantity = 2 WHERE id = ?').run(l.id) })
  else ops.push({ desc: `สูตร ${l.name}: พริกไทย ${l.quantity}${l.unit} (ไม่เกิน 2 — คงไว้)`, run: () => {} })
}

// 6) พาเมซานใช้จริงไม่เกิน 5 g ต่อจาน (เดิมคาโบนาร่าตั้งไว้ 30 g)
const parmesan = item('STK-ING-PMC')
for (const l of db.prepare(`SELECT bi.id, p.name, bi.quantity, bi.unit FROM bom_items bi JOIN boms b ON b.id = bi.bom_id JOIN stock_items p ON p.id = b.product_id WHERE bi.material_id = ? AND b.status = 'ACTIVE'`).all(parmesan.id)) {
  if (Number(l.quantity) > 5) ops.push({ desc: `สูตร ${l.name}: พาเมซาน ${l.quantity}${l.unit} → 5${l.unit}`, run: () => db.prepare('UPDATE bom_items SET quantity = 5 WHERE id = ?').run(l.id) })
}

// ── สูตรเมนูในบิล POS-059 (bom_id ที่เมนู POS ล็อกไว้จริง) ──
const BOM_KAOPAD_KUNG = 'ba2334b60eb34ee290d5636e0'   // ข้าวผัดกุ้ง
const BOM_SALAD_AVO = '772034f90b724fd084cfe45a4'     // สลัดอะโวอกไก่
const BOM_CARBONARA = '3895df58e35c40f7944a45077'     // สปาเกตตี้คาโบนาร่า
const meat = item('ING-MEAT'), shrimp = item('ING-SHR'), breast = item('RAW-021')
const line = (bomId, matId) => db.prepare('SELECT id, quantity, unit FROM bom_items WHERE bom_id = ? AND material_id = ?').all(bomId, matId)

// 7) ข้าวผัดกุ้ง: กุ้งบรรทัดเดียว 80 g, ลบ "เนื้อสัตว์"
for (const l of line(BOM_KAOPAD_KUNG, meat.id)) ops.push({ desc: `ข้าวผัดกุ้ง: ลบ เนื้อสัตว์ ${l.quantity}${l.unit}`, run: () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(l.id) })
for (const l of line(BOM_KAOPAD_KUNG, shrimp.id)) ops.push({ desc: `ข้าวผัดกุ้ง: กุ้งสด ${l.quantity}${l.unit} → 80g`, run: () => db.prepare(`UPDATE bom_items SET quantity = 80, unit = 'g' WHERE id = ?`).run(l.id) })

// 8) สลัดอะโวอกไก่: เนื้อสัตว์ → อกไก่ 80 g
for (const l of line(BOM_SALAD_AVO, meat.id)) ops.push({ desc: `สลัดอะโวอกไก่: เนื้อสัตว์ ${l.quantity}${l.unit} → RAW-021 ${breast.name} 80g (หน่วยเก็บ ${breast.base_unit})`, run: () => db.prepare(`UPDATE bom_items SET material_id = ?, quantity = 80, unit = 'g' WHERE id = ?`).run(breast.id, l.id) })

// 9) ชีสเชดด้า SKU ใหม่ (คัดลอกโครงจากพาเมซาน ซึ่งเป็นวัตถุดิบหน่วย g หมวดเดียวกัน)
let cheddarId = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND sku = 'ING-CHEDDAR'`).get(T)?.id
if (!cheddarId) {
  cheddarId = crypto.randomBytes(12).toString('hex')
  const tpl = item('STK-ING-PMC')
  const row = { ...tpl, id: cheddarId, sku: 'ING-CHEDDAR', name: 'ชีสเชดด้า', quantity: 0, sealed_qty: 0, unit_cost: 0, status: 'ACTIVE', created_at: now, updated_at: now }
  for (const c of ['purchase_price', 'purchase_unit', 'barcode', 'image_url', 'description', 'min_stock', 'max_stock']) if (c in row) row[c] = null
  const keys = Object.keys(row)
  ops.push({ desc: `สร้าง SKU ING-CHEDDAR "ชีสเชดด้า" หน่วย ${tpl.base_unit} หมวด ${tpl.category} สต็อก 0`, run: () => db.prepare(`INSERT INTO stock_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k])) })
}

// 10) ซอสคาโบนาร่า = ของกึ่งสำเร็จทำสดทีละจาน: 1 ชุด = 100 ml
const sauce = item('ING-CRM'), milk = item('ING-M01-2L'), red = item('ING-MR1'), yellow = item('ING-MY1'), egg = item('RAW-013')
const sauceBom = db.prepare(`SELECT id FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'`).get(T, sauce.id)
if (sauceBom) throw new Error('ซอสคาโบนาร่ามีสูตร ACTIVE อยู่แล้ว — ตรวจด้วยมือก่อน')
const sauceBomId = crypto.randomBytes(12).toString('hex')
const sauceLines = [[milk.id, 60, 'g', 'นมสด'], [red.id, 60, 'g', 'นมข้นแดง'], [egg.id, 1, 'pcs', 'ไข่ไก่'], [cheddarId, 10, 'g', 'ชีสเชดด้า']]
ops.push({
  desc: `สร้างสูตรซอสคาโบนาร่า (กึ่งสำเร็จ, ได้ 100 ml): ${sauceLines.map(l => `${l[3]} ${l[1]}${l[2]}`).join(' + ')}; ING-CRM หมวด → wip`,
  run: () => {
    db.prepare(`UPDATE stock_items SET category = 'wip', updated_at = ? WHERE id = ?`).run(now, sauce.id)
    db.prepare(`INSERT INTO boms (id, tenant_id, product_id, parent_id, version, status, level, is_semi_finished, created_at, updated_at, output_qty, output_unit) VALUES (?, ?, ?, NULL, 'standard', 'ACTIVE', 1, 1, ?, ?, 100, 'ml')`).run(sauceBomId, T, sauce.id, now, now)
    sauceLines.forEach(([mid, q, u], i) => db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order, unit) VALUES (?, ?, ?, 'MATERIAL', ?, NULL, ?, NULL, ?, ?)`).run(crypto.randomBytes(12).toString('hex'), T, sauceBomId, mid, q, i, u))
  },
})
// สปาเกตตี้: นมข้นที่ใส่ตรง ๆ ย้ายเข้าไปอยู่ในซอสแล้ว + หน่วยซอสให้ตรงกับหน่วยผลผลิต (ml)
for (const m of [yellow, red]) for (const l of line(BOM_CARBONARA, m.id)) ops.push({ desc: `คาโบนาร่า: ลบ ${m.name} ${l.quantity}${l.unit} (อยู่ในซอสแล้ว)`, run: () => db.prepare('DELETE FROM bom_items WHERE id = ?').run(l.id) })
for (const l of line(BOM_CARBONARA, sauce.id)) ops.push({ desc: `คาโบนาร่า: ซอส ${l.quantity}${l.unit} → ${l.quantity}ml`, run: () => db.prepare(`UPDATE bom_items SET unit = 'ml' WHERE id = ?`).run(l.id) })

console.log(`=== fix-kidshouse-boms ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
ops.forEach((o, i) => console.log(`${i + 1}. ${o.desc}`))

if (!APPLY) { console.log('\n(dry-run — ยังไม่เขียนอะไร ใส่ --apply เพื่อลงจริง)'); process.exit(0) }

const backup = path.join(__dirname, '..', `dev.db.bak-kidshouse-boms-${now.replace(/[:.]/g, '-')}`)
db.backup(backup).then(() => {
  console.log(`backup → ${backup}`)
  db.transaction(() => ops.forEach(o => o.run()))()
  console.log(`ลงจริงเสร็จ ${ops.length} ขั้น`)
}).catch(e => { console.error('ล้มเหลว — ไม่มีอะไรถูกเขียน:', e); process.exitCode = 1 })
