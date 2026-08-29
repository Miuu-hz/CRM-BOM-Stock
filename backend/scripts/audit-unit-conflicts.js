#!/usr/bin/env node
/**
 * Sweep every unit_conversions row and ask: if this rule did not exist, would the
 * remaining rules imply a different rate for the same pair of units?
 *
 * A "yes" means the data contradicts itself — the resolver still answers, but the
 * answer depends on which unit you ask for. Read-only.
 *
 *   node scripts/audit-unit-conflicts.js
 */
const path = require('path')
const Database = require('better-sqlite3')
const svc = require(path.join(__dirname, '..', 'dist', 'services', 'unitConversion.service'))

const dbPath = path.join(__dirname, '..', 'dev.db')
const db = new Database(dbPath, { readonly: true })

const rows = db.prepare(`
  SELECT uc.id, uc.tenant_id, uc.material_id, uc.from_unit, uc.to_unit,
         uc.conversion_factor, uc.notes,
         s.name AS material_name, s.sku AS material_sku
  FROM unit_conversions uc
  LEFT JOIN stock_items s ON uc.material_id = s.id
  ORDER BY uc.tenant_id, uc.material_id, uc.from_unit
`).all()

console.log('═'.repeat(70))
console.log('  UNIT CONVERSION CONFLICT SCAN — read-only')
console.log('═'.repeat(70))
console.log('db    :', dbPath)
console.log('rules :', rows.length)
console.log('')

const seen = new Set()
const found = []

for (const r of rows) {
  const c = svc.detectConversionConflict(
    r.tenant_id,
    r.from_unit,
    r.to_unit,
    Number(r.conversion_factor),
    r.material_id || undefined,
    r.id,
  )
  if (!c) continue

  // A mutually contradicting pair reports from both sides; keep one entry.
  const scope = r.material_id || '(ทั้งบริษัท)'
  const pair = [c.fromUnit, c.toUnit].sort().join('|')
  const key = `${r.tenant_id}|${scope}|${pair}`
  if (seen.has(key)) continue
  seen.add(key)

  found.push({ row: r, conflict: c, scope })
}

if (!found.length) {
  console.log('  ✓ ไม่พบกฎที่ขัดกันเลย')
} else {
  console.log(`  พบ ${found.length} จุดที่ขัดกัน:\n`)
  for (const { row, conflict, scope } of found) {
    const who = row.material_id
      ? `${row.material_name || '(ไม่ทราบชื่อ)'} [${row.material_sku || row.material_id}]`
      : 'กฎทั้งบริษัท'
    console.log(`  ⚠ ${who}`)
    console.log(`      กฎที่ตั้งไว้ : 1 ${conflict.fromLabel} = ${row.conversion_factor} ${conflict.toLabel}` +
      (row.notes ? `   // ${row.notes}` : ''))
    console.log(`      กฎอื่นบอกว่า : 1 ${conflict.fromLabel} = ${conflict.existingFactor} ${conflict.toLabel}` +
      (conflict.path.length > 2 ? `  (ผ่าน ${conflict.pathLabels.join(' → ')})` : `  (${conflict.source})`))
    const ratio = Number(row.conversion_factor) / conflict.existingFactor
    console.log(`      ต่างกัน     : ${ratio.toFixed(2)} เท่า   | rule id ${row.id}`)
    console.log('')
  }
  console.log('  แก้โดยลบกฎที่ผิดออกหนึ่งข้อ แล้วปล่อยให้ระบบคำนวณเส้นทางที่เหลือเอง')
}

console.log('═'.repeat(70))
