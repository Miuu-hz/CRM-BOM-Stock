// Testshop FG-001..FG-012: base_unit='pcs', sale_unit='set', no unit_conversions row.
// Confirming an SO in 'set' throws "ไม่พบการแปลงหน่วย set -> pcs" (see shared.ts deductStockForSO).
// Fix: insert one per-item rule 1 set = 1 pcs for each, matching the existing per-item
// row convention (from_unit = non-base unit, to_unit = base unit, factor = how many
// base units per 1 from_unit; is_global = 0) confirmed against live rows such as
// sachet->g=1000, pack->pcs=6.
//
// Usage:
//   node 2026-10-04-set-unit-rules.js                 (dry run, default — prints only)
//   node 2026-10-04-set-unit-rules.js --apply --backup=/root/erp-backup-XXXX.db
//
// Idempotent: skips any item that already has ANY unit_conversions row for its id
// (material_id). Re-running after a successful apply changes nothing.

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const DB_PATH = '/opt/crm/backend/dev.db'
const TENANT = 'Testshop'
const SKUS = Array.from({ length: 12 }, (_, i) => 'FG-' + String(i + 1).padStart(3, '0'))

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

const items = db.prepare(
  `SELECT id, sku, name, base_unit, sale_unit FROM stock_items WHERE tenant_id = ? AND sku IN (${SKUS.map(() => '?').join(',')}) ORDER BY sku`
).all(TENANT, ...SKUS)

if (items.length !== SKUS.length) {
  console.log(`WARNING: expected ${SKUS.length} items, found ${items.length}`)
}

const hasRule = db.prepare('SELECT 1 FROM unit_conversions WHERE material_id = ? LIMIT 1')

const plan = []
for (const it of items) {
  if (hasRule.get(it.id)) {
    plan.push({ ...it, action: 'SKIP (rule already exists)' })
    continue
  }
  plan.push({ ...it, action: `INSERT ${it.sale_unit} -> ${it.base_unit} = 1` })
}

console.log(`=== set-unit-rules ${APPLY ? 'APPLY' : 'DRY RUN'} — tenant=${TENANT} ===`)
for (const p of plan) {
  console.log(`${p.sku.padEnd(8)} ${p.name.padEnd(28)} base=${p.base_unit} sale=${p.sale_unit}  before: (no rule)  ->  ${p.action}`)
}
const toInsert = plan.filter(p => p.action.startsWith('INSERT'))
console.log(`\n${toInsert.length} row(s) to insert, ${plan.length - toInsert.length} skipped (already has a rule)`)

if (!APPLY) {
  console.log('\n(dry run — no changes made. Re-run with --apply --backup=<path> to write.)')
  process.exit(0)
}

const now = new Date().toISOString()
const insert = db.prepare(`INSERT INTO unit_conversions
  (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`)

const tx = db.transaction(() => {
  for (const p of toInsert) {
    const id = crypto.randomBytes(12).toString('hex')
    insert.run(id, TENANT, p.id, p.sale_unit, p.base_unit, 1, now, now)
    console.log(`APPLIED ${p.sku}: inserted unit_conversions id=${id} (${p.sale_unit} -> ${p.base_unit} = 1)`)
  }
})
tx()
db.pragma('wal_checkpoint(TRUNCATE)')
console.log(`\nDone. ${toInsert.length} row(s) inserted.`)
