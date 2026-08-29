#!/usr/bin/env node
/**
 * audit-units.js — READ-ONLY report on unit_conversions + stock_items units.
 *
 *   cd /opt/crm/backend && node scripts/audit-units.js
 *   node scripts/audit-units.js --json      # machine-readable
 *
 * This script NEVER writes. It opens dev.db read-only.
 */
const {
  MAP_SOURCE, normalizeUnit, categoryOf, RISKY_GLOBAL_UNITS,
  ul, openDb, analyze,
} = require('./unit-lib')

const JSON_MODE = process.argv.includes('--json')
const out = []
const P = (s = '') => out.push(s)
const H = (n, title) => { P(); P(`${'━'.repeat(70)}`); P(`[${n}] ${title}`); P('━'.repeat(70)) }

const { db, dbPath } = openDb(true)
const a = analyze(db)

const desc = r =>
  `${r.material_id ? 'MATERIAL' : 'GLOBAL  '}  ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}` +
  (r.notes ? `   // ${r.notes}` : '')
const named = id => {
  const s = a.stockById.get(id)
  return s ? `${s.name} [${s.sku}]` : `<orphan ${id}>`
}

P('═'.repeat(70))
P('  UNIT CONVERSION AUDIT — read-only')
P('═'.repeat(70))
P(`db            : ${dbPath}`)
P(`UNIT_NAME_MAP : ${MAP_SOURCE}`)
P(`generated     : ${new Date().toISOString()}`)
P(`rows in unit_conversions : ${a.conversions.length}`)
P(`rows in stock_items      : ${a.stock.length}`)
const tenants = [...new Set(a.conversions.map(c => c.tenant_id))]
P(`tenants                  : ${tenants.join(', ')}`)

// ── 1 ──────────────────────────────────────────────────────────────
H(1, 'REDUNDANT SYNONYM ROWS — safe to delete')
P('from_unit and to_unit normalize to the SAME code, so normalizeUnit()')
P('in the app already handles them. Keeping them only makes the unit')
P('dropdown show the same unit twice.')
P()
if (!a.redundantSynonyms.length) P('  (none)')
for (const r of a.redundantSynonyms) {
  P(`  ✗ ${desc(r)}`)
  P(`      normalizes to: ${r.nFrom} → ${r.nTo}   scope: ${r.material_id ? named(r.material_id) : 'tenant-wide'}`)
  P(`      id: ${r.id}`)
}
P(`  → ${a.redundantSynonyms.length} row(s) can be deleted with no behaviour change.`)

// ── 2 ──────────────────────────────────────────────────────────────
H(2, 'NON-NORMALIZED UNITS IN unit_conversions')
P('Stored value differs from normalizeUnit(value). The app normalizes at')
P('lookup time, so these rows are reachable, but they pollute the unit list.')
P()
if (!a.nonNormalized.length) P('  (none)')
for (const r of a.nonNormalized) {
  P(`  ~ ${desc(r)}`)
  P(`      should be : ${r.nFrom} → ${r.nTo} = ${r.conversion_factor}`)
  P(`      scope     : ${r.material_id ? named(r.material_id) : 'tenant-wide'}   id: ${r.id}`)
}
P()
P('  After normalizing, these rows COLLIDE with an existing row:')
if (!a.duplicateAfterNormalize.length && !a.conflictAfterNormalize.length) P('    (none)')
for (const d of a.duplicateAfterNormalize) {
  P(`    = ${d.key}  (same factor ${d.group[0].conversion_factor}) — duplicate, extras droppable:`)
  d.group.forEach((r, i) => P(`        ${i === 0 ? 'KEEP' : 'DROP'}  ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}  id:${r.id}`))
}
for (const c of a.conflictAfterNormalize) {
  P(`    ! ${c.key}  CONFLICTING factors ${c.factors.join(' vs ')} — needs a human:`)
  c.group.forEach(r => P(`        ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}  id:${r.id}`))
}

// ── 3 ──────────────────────────────────────────────────────────────
H(3, 'RISKY TENANT-WIDE RULES ON PACKAGING / COUNT UNITS')
P('A pack/box/case/bag/set rule means something different for every')
P('product (1 pack = 12 pcs vs 1 pack of eggs = 30 eggs). A tenant-wide')
P('rule on these silently applies to EVERY product that uses the unit.')
P('NOT auto-fixable — the owner must decide.')
P()
if (!a.riskyGlobals.length) P('  (none)')
for (const x of a.riskyGlobals) {
  const r = x.row
  const risky = [r.nFrom, r.nTo].filter(u => RISKY_GLOBAL_UNITS.has(u)).join(', ')
  P(`  ⚠ GLOBAL  ${ul(r.nFrom)} → ${ul(r.nTo)} = ${r.conversion_factor}   id: ${r.id}`)
  P(`      risky unit(s)  : ${risky}`)
  P(`      meaning        : "every ${r.nFrom} in this tenant = ${r.conversion_factor} ${r.nTo}"`)
  P(`      products using "${r.nFrom}" : ${x.affectedFrom.length}`)
  x.affectedFrom.slice(0, 8).forEach(s => P(`          - ${s.name} [${s.sku}]  (${s.cols.join(',')})`))
  if (x.affectedFrom.length > 8) P(`          ... +${x.affectedFrom.length - 8} more`)
  P(`      products using "${r.nTo}"   : ${x.affectedTo.length}`)
  x.affectedTo.slice(0, 8).forEach(s => P(`          - ${s.name} [${s.sku}]  (${s.cols.join(',')})`))
  if (x.affectedTo.length > 8) P(`          ... +${x.affectedTo.length - 8} more`)
  if (x.overriddenBy.length) {
    P(`      already overridden per-product (material rule wins):`)
    x.overriddenBy.forEach(o => P(`          - ${named(o.material_id)} : ${o.nFrom} → ${o.nTo} = ${o.conversion_factor}`))
  }
  P()
}

// ── 4 ──────────────────────────────────────────────────────────────
H(4, 'TENANT-WIDE RULES THAT CROSS UNIT CATEGORIES')
P('e.g. weight ↔ volume, container ↔ weight. These create shortcuts in the')
P('conversion graph that let ANY product hop between categories, which is')
P('only correct for density-1 liquids / one specific product.')
P()
if (!a.crossCategoryGlobals.length) P('  (none)')
for (const x of a.crossCategoryGlobals) {
  const r = x.row
  P(`  ⚠ GLOBAL  ${ul(r.nFrom)} → ${ul(r.nTo)} = ${r.conversion_factor}   [${x.catFrom} → ${x.catTo}]`)
  P(`      notes: ${r.notes || '-'}   id: ${r.id}`)
}

// ── 5 ──────────────────────────────────────────────────────────────
H(5, 'NON-NORMALIZED / UNKNOWN UNITS IN stock_items')
P('columns checked: unit, base_unit, sale_unit, display_unit')
P()
const norm5 = a.stockUnitIssues.filter(x => x.kind === 'normalize')
const unk5 = a.stockUnitIssues.filter(x => x.kind === 'unknown')

const groupBy = (list, keyFn) => {
  const m = new Map()
  for (const x of list) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return [...m.entries()].sort((p, q) => q[1].length - p[1].length)
}

P(`  a) fixable via UNIT_NAME_MAP — ${norm5.length} cell(s) across ` +
  `${new Set(norm5.map(x => x.id)).size} product(s), grouped by value:`)
if (!norm5.length) P('     (none)')
for (const [k, items] of groupBy(norm5, x => `${x.value} ⇒ ${x.normalized}`)) {
  const cols = groupBy(items, x => x.col).map(([c, l]) => `${c}×${l.length}`).join(' ')
  P(`     ~ "${k}"   ${items.length} cell(s)   [${cols}]`)
  P(`         e.g. ${items.slice(0, 4).map(x => x.sku).join(', ')}${items.length > 4 ? `, … +${items.length - 4}` : ''}`)
}
P()
P('     NOTE: normalizing these changes the RAW stored string. Screens that print')
P('     the column directly will switch from "แก้ว" to "glass"; screens that go')
P('     through UNIT_LABELS keep showing Thai. Worth eyeballing POS / stock list')
P('     before applying this part.')
P()
P(`  b) unknown to the system, NOT auto-fixable (${unk5.length} cell(s)):`)
if (!unk5.length) P('     (none)')
for (const [k, items] of groupBy(unk5, x => x.value)) {
  P(`     ? "${k}"  ${items.length} cell(s)  →  ${items.map(x => `[${x.sku}].${x.col}`).join(', ')}`)
  P(`         no UNIT_NAME_MAP entry and no UNIT_LABELS code — add a mapping first, or leave it.`)
}

// ── 6 ──────────────────────────────────────────────────────────────
H(6, 'CONFLICTING RULES')
P('a) tenant-wide rule vs per-product rule for the same unit pair.')
P('   At runtime the per-product rule WINS.')
P()
if (!a.globalVsMaterial.length) P('   (none)')
for (const c of a.globalVsMaterial) {
  P(`   ! ${c.material.nFrom} → ${c.material.nTo}`)
  P(`       tenant-wide : ${c.global.conversion_factor}   (id ${c.global.id})`)
  P(`       ${(c.stock ? c.stock.name + ' [' + c.stock.sku + ']' : c.material.material_id).padEnd(11)} : ${c.material.conversion_factor}   (id ${c.material.id})  ← WINS`)
}
P()
P('b) inverse pairs that are not reciprocal (A→B × B→A ≠ 1):')
if (!a.inverseMismatch.length) P('   (none)')
for (const m of a.inverseMismatch) {
  P(`   ! ${m.a.nFrom}→${m.a.nTo}=${m.a.conversion_factor} and ${m.b.nFrom}→${m.b.nTo}=${m.b.conversion_factor}  (product = ${m.product}, expected 1)`)
  P(`       scope: ${m.a.material_id ? named(m.a.material_id) : 'tenant-wide'}`)
}

// ── 7 ──────────────────────────────────────────────────────────────
H(7, 'ORPHAN ROWS — material_id points at a missing stock item')
if (!a.orphans.length) P('  (none)')
for (const r of a.orphans) P(`  ✗ ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}   material_id=${r.material_id}  id:${r.id}`)

// ── summary ────────────────────────────────────────────────────────
H('=', 'SUMMARY')
const dropExtras = a.duplicateAfterNormalize.reduce((n, d) => n + d.group.length - 1, 0)
P(`  redundant synonym rows (safe delete)      : ${a.redundantSynonyms.length}`)
P(`  non-normalized conversion rows            : ${a.nonNormalized.length}`)
P(`    of which duplicate after normalize      : ${dropExtras}  (safe delete)`)
P(`    of which conflict after normalize       : ${a.conflictAfterNormalize.length}  (MANUAL)`)
P(`  risky tenant-wide packaging rules         : ${a.riskyGlobals.length}  (MANUAL — owner decides)`)
P(`  cross-category tenant-wide rules          : ${a.crossCategoryGlobals.length}  (MANUAL)`)
P(`  stock_items unit values to normalize      : ${norm5.length}`)
P(`  stock_items unit values unknown           : ${unk5.length}  (MANUAL)`)
P(`  global-vs-material factor conflicts       : ${a.globalVsMaterial.length}  (informational)`)
P(`  non-reciprocal inverse pairs              : ${a.inverseMismatch.length}  (informational)`)
P(`  orphan rows                               : ${a.orphans.length}  (safe delete)`)
P()
P('  Auto-fixable by scripts/cleanup-units.js  : ' +
  (a.redundantSynonyms.length + a.nonNormalized.length + norm5.length + a.orphans.length) + ' change(s)')
P('  Requires a human decision                 : ' +
  (a.riskyGlobals.length + a.crossCategoryGlobals.length + a.conflictAfterNormalize.length + unk5.length) + ' item(s)')
P()

db.close()

if (JSON_MODE) {
  console.log(JSON.stringify({
    redundantSynonyms: a.redundantSynonyms,
    nonNormalized: a.nonNormalized,
    duplicateAfterNormalize: a.duplicateAfterNormalize,
    conflictAfterNormalize: a.conflictAfterNormalize,
    riskyGlobals: a.riskyGlobals,
    crossCategoryGlobals: a.crossCategoryGlobals,
    stockUnitIssues: a.stockUnitIssues,
    globalVsMaterial: a.globalVsMaterial,
    inverseMismatch: a.inverseMismatch,
    orphans: a.orphans,
  }, null, 2))
} else {
  console.log(out.join('\n'))
}
