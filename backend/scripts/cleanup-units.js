#!/usr/bin/env node
/**
 * cleanup-units.js — clean up unit_conversions / stock_items unit columns.
 *
 *   cd /opt/crm/backend
 *   node scripts/cleanup-units.js            # DRY RUN (default) — writes nothing
 *   node scripts/cleanup-units.js --apply    # actually write (auto-backup first)
 *
 * Safe to run repeatedly — every action is idempotent.
 *
 * WHAT IT DOES
 *   1. delete redundant synonym rows      (from_unit and to_unit normalize to the same code)
 *   2. delete orphan rows                 (material_id -> stock item that no longer exists)
 *   3. normalize from_unit / to_unit      (or delete the row if an identical normalized row exists)
 *   4. normalize stock_items unit / base_unit / sale_unit / display_unit
 *
 * WHAT IT DELIBERATELY DOES **NOT** DO
 *   - it never touches risky tenant-wide packaging rules (pack->g, pack->bottle, ...)
 *   - it never touches cross-category tenant-wide rules  (g<->ml, ...)
 *   - it never resolves conflicting factors
 *   Deleting those could break existing goods-receipt / BOM documents that
 *   still rely on them. They are reported for the owner to decide.
 */
const fs = require('fs')
const path = require('path')
const { normalizeUnit, RISKY_GLOBAL_UNITS, ul, openDb, analyze, STOCK_UNIT_COLS } = require('./unit-lib')

const APPLY = process.argv.includes('--apply')
const SKIP_STOCK = process.argv.includes('--skip-stock')   // leave stock_items alone
const MODE = APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'

const line = c => c.repeat(70)
const log = (...s) => console.log(...s)

// ── open db ────────────────────────────────────────────────────────
const { db, dbPath } = openDb(!APPLY)   // readonly unless --apply
const a = analyze(db)
const named = id => {
  const s = a.stockById.get(id)
  return s ? `${s.name} [${s.sku}]` : `<orphan ${id}>`
}

log(line('═'))
log('  CLEANUP UNITS  —  mode: ' + MODE)
log(line('═'))
log('db : ' + dbPath)
if (SKIP_STOCK) log('flag: --skip-stock  → stock_items will NOT be touched')
if (!APPLY) log('NOTE: this run opened the database READ-ONLY. Nothing can be written.')
log('')

// ── build the plan ─────────────────────────────────────────────────
/** @type {{kind:string,sql:string,params:any[],label:string}[]} */
const plan = []
const manual = []

const toDelete = new Set()

// 1. redundant synonyms
for (const r of a.redundantSynonyms) {
  toDelete.add(r.id)
  plan.push({
    kind: 'delete-synonym',
    sql: 'DELETE FROM unit_conversions WHERE id = ?',
    params: [r.id],
    label: `DELETE synonym  ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor} ` +
      `(both normalize to "${r.nFrom}")  scope=${r.material_id ? named(r.material_id) : 'tenant-wide'}  id=${r.id}`,
  })
}

// 2. orphans
for (const r of a.orphans) {
  if (toDelete.has(r.id)) continue
  toDelete.add(r.id)
  plan.push({
    kind: 'delete-orphan',
    sql: 'DELETE FROM unit_conversions WHERE id = ?',
    params: [r.id],
    label: `DELETE orphan   ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}  ` +
      `material_id=${r.material_id} (missing)  id=${r.id}`,
  })
}

// 3. normalize conversion rows
// index of rows that will still exist after the deletes above, keyed by normalized identity
const survivors = a.conversions.filter(r => !toDelete.has(r.id))
const idKey = r => `${r.tenant_id}|${r.material_id || ''}|${r.nFrom}|${r.nTo}`
const occupied = new Map()   // normalized key -> row that already stores it in normalized form
for (const r of survivors) {
  if (r.from_unit === r.nFrom && r.to_unit === r.nTo) occupied.set(idKey(r), r)
}

for (const r of survivors) {
  if (r.from_unit === r.nFrom && r.to_unit === r.nTo) continue   // already normalized
  const k = idKey(r)
  const holder = occupied.get(k)
  if (holder) {
    if (holder.conversion_factor === r.conversion_factor) {
      toDelete.add(r.id)
      plan.push({
        kind: 'delete-duplicate',
        sql: 'DELETE FROM unit_conversions WHERE id = ?',
        params: [r.id],
        label: `DELETE dup      ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor}  ` +
          `(normalizes to ${r.nFrom} → ${r.nTo}, already stored as id=${holder.id})  id=${r.id}`,
      })
    } else {
      manual.push(
        `CONFLICT  ${r.from_unit} → ${r.to_unit} = ${r.conversion_factor} (id ${r.id}) normalizes onto\n` +
        `            ${holder.from_unit} → ${holder.to_unit} = ${holder.conversion_factor} (id ${holder.id})\n` +
        `            different factors — left untouched, a human must pick one.`)
    }
    continue
  }
  occupied.set(k, { ...r, from_unit: r.nFrom, to_unit: r.nTo })
  plan.push({
    kind: 'normalize-conv',
    sql: 'UPDATE unit_conversions SET from_unit = ?, to_unit = ?, updated_at = ? WHERE id = ?',
    params: [r.nFrom, r.nTo, new Date().toISOString(), r.id],
    label: `NORMALIZE conv  ${r.from_unit} → ${r.to_unit}   ⇒   ${r.nFrom} → ${r.nTo}  ` +
      `(factor ${r.conversion_factor} unchanged)  id=${r.id}`,
  })
}

// 4. normalize stock_items unit columns
for (const x of a.stockUnitIssues) {
  if (x.kind !== 'normalize') continue
  if (SKIP_STOCK) continue
  plan.push({
    kind: 'normalize-stock',
    sql: `UPDATE stock_items SET ${x.col} = ?, updated_at = ? WHERE id = ?`,
    params: [x.normalized, new Date().toISOString(), x.id],
    label: `NORMALIZE stock [${x.sku}] ${x.name}  .${x.col}: "${x.value}" ⇒ "${x.normalized}"`,
    from: x.value, to: x.normalized, sku: x.sku,
  })
}

// ── manual-only findings (reported, never auto-changed) ────────────
for (const x of a.riskyGlobals) {
  const r = x.row
  const risky = [r.nFrom, r.nTo].filter(u => RISKY_GLOBAL_UNITS.has(u)).join(', ')
  manual.push(
    `RISKY GLOBAL  ${ul(r.nFrom)} → ${ul(r.nTo)} = ${r.conversion_factor}  (id ${r.id})\n` +
    `            packaging unit "${risky}" is product-specific; this rule applies tenant-wide.\n` +
    `            products using "${r.nFrom}": ${x.affectedFrom.length}` +
    (x.affectedFrom.length ? '  → ' + x.affectedFrom.slice(0, 6).map(s => s.sku).join(', ') +
      (x.affectedFrom.length > 6 ? ', …' : '') : '') + '\n' +
    `            NOT deleted automatically — removing it can break existing documents\n` +
    `            that still convert through this rule. Owner should replace it with\n` +
    `            per-product rules first, then delete it from the Settings UI.`)
}
for (const x of a.crossCategoryGlobals) {
  const r = x.row
  manual.push(
    `CROSS-CATEGORY GLOBAL  ${ul(r.nFrom)} → ${ul(r.nTo)} = ${r.conversion_factor}  ` +
    `[${x.catFrom} → ${x.catTo}]  (id ${r.id})\n` +
    `            notes: ${r.notes || '-'}\n` +
    `            lets every product hop ${x.catFrom} ↔ ${x.catTo}. NOT auto-changed.`)
}
for (const x of a.stockUnitIssues.filter(y => y.kind === 'unknown')) {
  manual.push(
    `UNKNOWN UNIT  [${x.sku}] ${x.name} .${x.col} = "${x.value}"\n` +
    `            no UNIT_NAME_MAP entry — cannot be normalized automatically.`)
}
for (const c of a.globalVsMaterial) {
  manual.push(
    `FACTOR CONFLICT  ${c.material.nFrom} → ${c.material.nTo}: tenant-wide ${c.global.conversion_factor} ` +
    `vs ${c.stock ? c.stock.sku : c.material.material_id} ${c.material.conversion_factor}\n` +
    `            per-product rule wins at runtime — informational only.`)
}

// ── print plan ─────────────────────────────────────────────────────
log(line('─'))
log(`PLAN — ${plan.length} change(s)`)
log(line('─'))
if (!plan.length) log('  nothing to do — database is already clean.')
const byKind = plan.reduce((m, p) => ((m[p.kind] = m[p.kind] || []).push(p), m), {})
for (const [kind, items] of Object.entries(byKind)) {
  log(`\n  ▸ ${kind}  (${items.length})`)
  if (kind === 'normalize-stock') {
    // too many to print one-by-one — group by the value being rewritten
    const g = new Map()
    for (const p of items) {
      const k = `${p.from} ⇒ ${p.to}`
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(p)
    }
    for (const [k, list] of [...g.entries()].sort((x, y) => y[1].length - x[1].length)) {
      log(`      "${k}"   ${list.length} cell(s)   e.g. ${list.slice(0, 4).map(p => p.sku).join(', ')}` +
        (list.length > 4 ? `, … +${list.length - 4}` : ''))
    }
    log('      ⚠ this rewrites the RAW stored string; screens printing the column')
    log('        directly will switch from Thai to the unit code.')
  } else {
    items.forEach(p => log('      ' + p.label))
  }
}

log('')
log(line('─'))
log(`NOT TOUCHED — needs a human decision (${manual.length})`)
log(line('─'))
if (!manual.length) log('  (none)')
manual.forEach(m => log('  • ' + m))

// ── apply ──────────────────────────────────────────────────────────
log('')
log(line('═'))
if (!APPLY) {
  log('DRY RUN complete. Nothing was written.')
  log('Re-run with --apply to execute the plan above (a backup is taken first).')
  log(line('═'))
  db.close()
  process.exit(0)
}

if (!plan.length) {
  log('APPLY: plan is empty, nothing to write, no backup taken.')
  log(line('═'))
  db.close()
  process.exit(0)
}

// backup BEFORE any write
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
const bak = `${dbPath}.bak-cleanup-${ts}`
db.pragma('wal_checkpoint(TRUNCATE)')   // fold the -wal into the main file first
fs.copyFileSync(dbPath, bak)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, bak + suffix)
}
log(`backup written : ${bak}  (${fs.statSync(bak).size} bytes)`)

const run = db.transaction(() => {
  for (const p of plan) db.prepare(p.sql).run(...p.params)
})
run()
log(`APPLIED ${plan.length} change(s).`)

// verify idempotency: re-analyze and confirm the auto-fixable set is now empty
const after = analyze(db)
const leftover =
  after.redundantSynonyms.length + after.orphans.length +
  after.nonNormalized.filter(r => !after.conflictAfterNormalize.some(c => c.group.some(g => g.id === r.id))).length +
  after.stockUnitIssues.filter(x => x.kind === 'normalize').length
log(`post-check: ${leftover} auto-fixable item(s) remaining (expected 0, ` +
  `except rows parked as CONFLICT above).`)
log(line('═'))
db.close()
