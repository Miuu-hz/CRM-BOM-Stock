#!/usr/bin/env node
/**
 * หจก.เอฟแอนด์บี เบดดิ้ง (tenant_msqy2xbn) — แก้หน่วยผ้า/ใยที่ทำให้ BOM แปลงหน่วยไม่ได้
 * (ต้อง deploy โค้ดที่รู้จักหน่วย in2 = ตร.นิ้ว ก่อน ไม่งั้น "ตร.นิ้ว" ใน BOM ยังไม่ถูก normalize)
 *
 * 1) กฎกลางของบริษัท m → in2 = 22000/6.4516 = 3410.0068 (เจ้าของยืนยัน: ผ้าทุกตัวหน้ากว้าง 220 ซม.)
 *    1 ตร.นิ้ว = 2.54² = 6.4516 ตร.ซม. · 1 m × 220 cm = 22000 ตร.ซม.
 * 2) บรรทัด BOM ของใย (สต็อกเป็นแผ่น) ที่กรอกเป็นกรัม → แผ่น
 *    เลขกรัมในชื่อใยคือ "เกรด" ไม่ใช่ปริมาณที่ใช้ → บรรทัด "<เกรด> g" = 1 แผ่น
 *    ข้ามบรรทัดที่ชื่อไม่มีเกรด หรือจำนวนไม่ใช่ทวีคูณของเกรด (พิมพ์รายการให้เจ้าของตัดสินใจ)
 *
 * ต้นทุน BOM คำนวณตอนอ่าน (bom.routes.ts) ไม่มีค่าเก็บไว้ต้อง recompute
 *
 * usage (รันใน backend/ เพื่อให้ require better-sqlite3 เจอ):
 *   node bedding-units.js --db <path/to/dev.db> [--dry-run]
 */
const Database = require('better-sqlite3')
const { randomUUID } = require('crypto')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1] : null
if (!dbPath) {
  console.error('usage: node bedding-units.js --db <path/to/dev.db> [--dry-run]')
  process.exit(1)
}

const T = 'tenant_msqy2xbn'
const M_TO_IN2 = 3410.0068 // 22000 / 6.4516
// เจ้าของยืนยันเกรดของใยที่ชื่อไม่มีเลขกรัมได้ที่นี่ เช่น { 'FIB-B-06-VAT': 150 }
const GRADE_OVERRIDE = {}

const G_UNITS = ['g', 'กรัม', 'กรัม.', 'gram', 'grams']
const SHEET_UNITS = ['sheet', 'แผ่น', 'sheets']

const db = new Database(dbPath, DRY ? { readonly: true } : {})
db.pragma('foreign_keys = ON')

const company = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(T)
if (!company || !String(company.name).includes('เบดดิ้ง')) {
  console.error(`ไม่ใช่ฐานข้อมูลของเบดดิ้ง (company_settings.name = ${company && company.name}) — หยุด`)
  process.exit(1)
}
console.log(`DB: ${dbPath} · ${company.name} · ${DRY ? 'DRY RUN (ไม่เขียน)' : 'APPLY'}`)

// ---------- 1) กฎ m → in2 ระดับบริษัท ----------
const existingRule = db.prepare(`
  SELECT id, from_unit, to_unit, conversion_factor FROM unit_conversions
  WHERE tenant_id = ? AND material_id IS NULL
    AND ((from_unit = 'm' AND to_unit = 'in2') OR (from_unit = 'in2' AND to_unit = 'm'))
`).get(T)
console.log('\n[1] กฎกลาง m → in2')
if (existingRule) {
  console.log(`  มีอยู่แล้ว ข้าม: ${JSON.stringify(existingRule)}`)
} else {
  console.log(`  จะเพิ่ม: material_id NULL, m → in2 = ${M_TO_IN2}`)
}

// ---------- 2) บรรทัด BOM ใยที่เป็นกรัม ----------
const lines = db.prepare(`
  SELECT bi.id, bi.bom_id, bi.quantity, bi.unit, si.sku, si.name,
         ps.sku AS product_sku, ps.name AS product_name, b.status AS bom_status
  FROM bom_items bi
  JOIN stock_items si ON si.id = bi.material_id
  JOIN boms b ON b.id = bi.bom_id
  LEFT JOIN stock_items ps ON ps.id = b.product_id
  WHERE bi.tenant_id = ?
    AND lower(trim(bi.unit)) IN (${G_UNITS.map(() => '?').join(',')})
    AND lower(trim(COALESCE(si.base_unit, si.unit))) IN (${SHEET_UNITS.map(() => '?').join(',')})
  ORDER BY si.sku, bi.quantity, ps.sku
`).all(T, ...G_UNITS, ...SHEET_UNITS)

const gradeOf = (sku, name) => {
  if (GRADE_OVERRIDE[sku]) return GRADE_OVERRIDE[sku]
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*กรัม/)
  return m ? Number(m[1]) : null
}

const fix = []
const skip = []
for (const l of lines) {
  const grade = gradeOf(l.sku, l.name)
  const sheets = grade ? Number(l.quantity) / grade : NaN
  if (grade && Number.isInteger(sheets) && sheets > 0) fix.push({ ...l, grade, sheets })
  else skip.push({ ...l, grade, reason: grade ? `${l.quantity} ไม่ใช่ทวีคูณของเกรด ${grade}` : 'ชื่อไม่มีเกรดกรัม' })
}

const summarize = (rows, extra) => {
  const g = new Map()
  for (const r of rows) {
    const k = `${r.sku} · ${r.quantity} ${r.unit}${extra(r)}`
    g.set(k, (g.get(k) || 0) + 1)
  }
  for (const [k, n] of g) console.log(`  ${k}  × ${n} บรรทัด`)
}
console.log(`\n[2] บรรทัด BOM ใย (สต็อกเป็นแผ่น) ที่กรอกเป็นกรัม: ${lines.length} บรรทัด`)
console.log(`  แปลงได้ ${fix.length} บรรทัด:`)
summarize(fix, (r) => ` → ${r.sheets} sheet (เกรด ${r.grade})`)
console.log(`  ข้าม ${skip.length} บรรทัด (ให้เจ้าของตัดสิน):`)
summarize(skip, (r) => ` — ${r.reason}`)
for (const r of skip) {
  console.log(`    - bom_item ${r.id} · ${r.sku} ${r.quantity} ${r.unit} · BOM ${r.bom_id} (${r.bom_status}) ${r.product_sku} ${r.product_name}`)
}

const oddSheet = db.prepare(`
  SELECT si.sku, bi.quantity, count(*) n FROM bom_items bi JOIN stock_items si ON si.id = bi.material_id
  WHERE bi.tenant_id = ? AND si.sku LIKE 'FIB%' AND bi.unit = 'sheet' AND bi.quantity >= 50
  GROUP BY 1, 2
`).all(T)
if (oddSheet.length) {
  console.log('  ⚠ ไม่แตะ แต่ดูน่าจะผิด (จำนวนแผ่นสูงผิดปกติ):')
  for (const r of oddSheet) console.log(`    ${r.sku} · ${r.quantity} sheet × ${r.n}`)
}

// ---------- apply ----------
if (!DRY) {
  const now = new Date().toISOString()
  db.transaction(() => {
    if (!existingRule) {
      // รูปเดียวกับ createConversion(): id 25 ตัวจาก uuid, หน่วย normalize แล้ว, is_global ปล่อย default 0
      db.prepare(`
        INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, notes, created_at, updated_at)
        VALUES (?, ?, NULL, 'm', 'in2', ?, ?, ?, ?)
      `).run(randomUUID().replace(/-/g, '').substring(0, 25), T, M_TO_IN2,
        'ผ้าหน้ากว้าง 220 ซม. (เจ้าของยืนยัน 2026-11-18): 1 m = 22000 ตร.ซม. = 22000/6.4516 ตร.นิ้ว', now, now)
    }
    const upd = db.prepare(`UPDATE bom_items SET unit = 'sheet', quantity = ? WHERE id = ? AND tenant_id = ? AND unit = ?`)
    const touch = db.prepare('UPDATE boms SET updated_at = ? WHERE id = ? AND tenant_id = ?')
    const boms = new Set()
    for (const l of fix) {
      if (upd.run(l.sheets, l.id, T, l.unit).changes !== 1) throw new Error(`update bom_item ${l.id} ไม่ตรง 1 แถว`)
      boms.add(l.bom_id)
    }
    for (const id of boms) touch.run(now, id, T)
    console.log(`\nเขียนแล้ว: กฎ m→in2 ${existingRule ? 'ข้าม (มีอยู่)' : 'เพิ่ม 1'} · bom_items ${fix.length} บรรทัด · boms.updated_at ${boms.size} ใบ`)
  })()
}

// ---------- verification ----------
console.log('\n[ตรวจผล]')
console.log('  กฎ m/in2 ระดับบริษัท:', JSON.stringify(db.prepare(`
  SELECT id, from_unit, to_unit, conversion_factor, notes, created_at FROM unit_conversions
  WHERE tenant_id = ? AND material_id IS NULL AND (from_unit IN ('m','in2') AND to_unit IN ('m','in2'))
`).all(T)))
console.log('  บรรทัดใยที่ยังเป็นกรัม:', JSON.stringify(db.prepare(`
  SELECT si.sku, bi.quantity, count(*) n FROM bom_items bi JOIN stock_items si ON si.id = bi.material_id
  WHERE bi.tenant_id = ? AND bi.unit = 'g' AND si.unit = 'sheet' GROUP BY 1, 2
`).all(T)))
console.log('  บรรทัดใยที่เป็นแผ่น:', JSON.stringify(db.prepare(`
  SELECT si.sku, bi.quantity, count(*) n FROM bom_items bi JOIN stock_items si ON si.id = bi.material_id
  WHERE bi.tenant_id = ? AND bi.unit = 'sheet' AND si.unit = 'sheet' GROUP BY 1, 2
`).all(T)))
db.close()
