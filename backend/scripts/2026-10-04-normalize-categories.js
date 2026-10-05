// tenant_bb_pillow only: normalize stock_items.category values.
//   'RAW_MATERIAL' (29) / 'material' (2) / '' (1)  ->  'raw'
//   'ขนมจีน'                      (exact name)      ->  'wip'      (owner: semi-finished)
//   'ข้าวสะโพกไก่ย่าง+กิมจิ'        (exact name)      ->  'finished'
//
// Does NOT touch 'SERVICE' (uppercase is the existing code convention), does NOT
// touch any other tenant, does NOT touch orphan-tenant rows.
//
// Usage:
//   node 2026-10-04-normalize-categories.js                 (dry run, default)
//   node 2026-10-04-normalize-categories.js --apply --backup=/root/erp-backup-XXXX.db
//
// Idempotent: the bulk update only matches rows still in {'RAW_MATERIAL','material',''};
// the two name-based updates only fire when the row's category differs from the target.
// Re-running after a successful apply finds nothing left to change.

const fs = require('fs')
const Database = require('better-sqlite3')

const DB_PATH = '/opt/crm/backend/dev.db'
const TENANT = 'tenant_bb_pillow'
const RAW_ALIASES = ['RAW_MATERIAL', 'material', '']
const NAME_FIXES = [
  { name: 'ขนมจีน', target: 'wip' },
  { name: 'ข้าวสะโพกไก่ย่าง+กิมจิ', target: 'finished' },
]
const SELLABLE = ['finished', 'wip', 'SERVICE']

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const backupArg = argv.find(a => a.startsWith('--backup='))
const BACKUP_PATH = backupArg ? backupArg.slice('--backup='.length) : null

function assertFreshBackup(p) {
  if (!p) throw new Error('--apply requires --backup=<path to a backup taken in the last 30 minutes>')
  if (!fs.existsSync(p)) throw new Error(`backup not found: ${p}`)
  const ageMs = Date.now() - fs.statSync(p).mtimeMs
  if (ageMs > 30 * 60 * 1000) {
    throw new Error(`backup ${p} is ${(ageMs / 60000).toFixed(1)} min old — refuse to apply (needs < 30 min)`)
  }
}

if (APPLY) assertFreshBackup(BACKUP_PATH)

const db = new Database(DB_PATH, { readonly: !APPLY })
const now = new Date().toISOString()

console.log(`=== normalize-categories ${APPLY ? 'APPLY' : 'DRY RUN'} — tenant=${TENANT} ===\n`)

// ---- 1. bulk raw-alias -> 'raw' ----
const rawRows = db.prepare(
  `SELECT id, sku, name, category FROM stock_items WHERE tenant_id = ? AND category IN (${RAW_ALIASES.map(() => '?').join(',')}) ORDER BY sku`
).all(TENANT, ...RAW_ALIASES)

console.log(`-- bulk raw-alias -> 'raw' (${rawRows.length} row(s)) --`)
for (const r of rawRows) {
  console.log(`${r.sku.padEnd(20)} ${r.name.padEnd(30)} category: '${r.category}' -> 'raw'`)
}

// ---- 2. the two name-based fixes ----
console.log(`\n-- name-based fixes --`)
const nameFixPlan = []
for (const fix of NAME_FIXES) {
  const matches = db.prepare('SELECT id, sku, name, category FROM stock_items WHERE tenant_id = ? AND name = ?').all(TENANT, fix.name)
  if (matches.length !== 1) {
    console.error(`ABORT: expected exactly 1 stock_items row named "${fix.name}" in ${TENANT}, found ${matches.length}`)
    process.exit(1)
  }
  const row = matches[0]
  if (row.category === fix.target) {
    console.log(`${row.sku.padEnd(20)} ${row.name.padEnd(30)} category already '${fix.target}' -> SKIP`)
  } else {
    console.log(`${row.sku.padEnd(20)} ${row.name.padEnd(30)} category: '${row.category}' -> '${fix.target}'`)
    nameFixPlan.push({ ...row, target: fix.target })
  }
}

console.log(`\nTotals: ${rawRows.length} bulk row(s), ${nameFixPlan.length}/${NAME_FIXES.length} name-fix row(s) pending`)

// ---- 3. report-only: would any pos_menu_configs row still be non-sellable? ----
// pos_menu_configs.product_id actually stores stock_items.id (confirmed: 0 unmatched
// join against stock_items for tenant_bb_pillow).
function reportNonSellable(label, categoryOverrides) {
  const rows = db.prepare(`
    SELECT pmc.id as pmc_id, si.sku, si.name, si.category
    FROM pos_menu_configs pmc JOIN stock_items si ON si.id = pmc.product_id
    WHERE pmc.tenant_id = ?
  `).all(TENANT)
  const bad = rows.filter(r => {
    const cat = categoryOverrides.get(r.sku) ?? r.category
    return !SELLABLE.includes(cat)
  })
  console.log(`\n-- ${label}: pos_menu_configs rows whose product would be non-sellable (not finished/wip/SERVICE) --`)
  if (bad.length === 0) console.log('(none)')
  else for (const b of bad) console.log(`${b.sku}  ${b.name}  category='${b.category}'`)
}

const overrides = new Map()
for (const r of rawRows) overrides.set(r.sku, 'raw')
for (const p of nameFixPlan) overrides.set(p.sku, p.target)
reportNonSellable('AFTER the planned change', overrides)

// ---- 4. report-only: stock items in quotation/SO lines that would become non-sellable ----
function reportQuotationSoExposure() {
  const skuToOverride = overrides
  const rawSkus = new Set([...rawRows.map(r => r.sku)])
  // Any stock item whose *new* category is 'raw' (bulk aliases) — the two name-fixed
  // items become sellable, so they are excluded by construction (not in rawSkus).
  if (rawSkus.size === 0) {
    console.log(`\n-- quotation/SO exposure for items becoming 'raw': (no items to check) --`)
    return
  }
  const placeholders = [...rawSkus].map(() => '?').join(',')
  const q = db.prepare(`
    SELECT DISTINCT si.sku, si.name, 'QUOTATION' as src, qi.quotation_id as doc_id
    FROM quotation_items qi JOIN stock_items si ON si.id = qi.stock_item_id
    WHERE qi.tenant_id = ? AND si.sku IN (${placeholders})
  `).all(TENANT, ...rawSkus)
  const s = db.prepare(`
    SELECT DISTINCT si.sku, si.name, 'SO' as src, soi.sales_order_id as doc_id
    FROM sales_order_items soi JOIN stock_items si ON si.id = soi.stock_item_id
    WHERE soi.tenant_id = ? AND si.sku IN (${placeholders})
  `).all(TENANT, ...rawSkus)
  const all = [...q, ...s]
  console.log(`\n-- quotation/SO exposure for items becoming 'raw' (report only, no action) --`)
  if (all.length === 0) console.log('(none)')
  else for (const a of all) console.log(`${a.src}  ${a.sku}  ${a.name}  doc=${a.doc_id}`)
}
reportQuotationSoExposure()

if (!APPLY) {
  console.log('\n(dry run — no changes made. Re-run with --apply --backup=<path> to write.)')
  process.exit(0)
}

const updateBulk = db.prepare(`UPDATE stock_items SET category = 'raw', updated_at = ? WHERE id = ?`)
const updateName = db.prepare(`UPDATE stock_items SET category = ?, updated_at = ? WHERE id = ?`)

const tx = db.transaction(() => {
  for (const r of rawRows) updateBulk.run(now, r.id)
  for (const p of nameFixPlan) updateName.run(p.target, now, p.id)
})
tx()
db.pragma('wal_checkpoint(TRUNCATE)')
console.log(`\nDone. ${rawRows.length} bulk row(s) + ${nameFixPlan.length} name-fix row(s) updated.`)
