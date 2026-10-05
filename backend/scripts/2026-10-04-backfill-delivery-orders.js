// Sales orders with status in CONFIRMED/PROCESSING/READY/PARTIAL/DELIVERED/COMPLETED
// that have no (non-cancelled) delivery_orders row. Create the DO by calling the
// app's own createDeliveryOrderForSO() (routes/sales/shared.ts, loaded from the
// COMPILED dist/ build — PM2 runs dist, not src) so numbering/items/links match
// exactly what the app would produce. No hand-written INSERTs.
//
// Stock: createDeliveryOrderForSO() only writes to delivery_orders /
// delivery_order_items. It contains no stock_items/stock_movements statement at
// all (read the function body below if you want to re-verify) — stock was already
// deducted at SO confirm by deductStockForSO(). So calling it here cannot double-
// deduct, by construction, not by inference.
//
// KNOWN GAP (do not "fix" by hand-inserting — report only): the function only
// creates a DO for the still-undelivered remainder (quantity - delivered_qty).
// When delivered_qty already equals quantity (true for most seed/demo rows — see
// memory project_erp_delivery_order_gap, same issue hit the 2026-09-13 backfill),
// items.length is 0 and the function returns null WITHOUT creating anything. This
// script surfaces that split instead of hiding it.
//
// Date: createDeliveryOrderForSO takes no date option. It always sets
// delivery_date = so.delivery_date (if set) else `new Date()` (current wall-clock
// time at the moment this script runs), and created_at/updated_at are always
// `new Date()` too. It cannot be told to use the invoice date. Implementing the
// "invoice date if invoiced else SO date" proposal would require editing the
// function itself — out of scope here (a backend agent is concurrently editing
// the sales route files) — so this is reported, not implemented.
//
// Usage:
//   node 2026-10-04-backfill-delivery-orders.js                 (dry run, default)
//   node 2026-10-04-backfill-delivery-orders.js --apply --backup=/root/erp-backup-XXXX.db
//
// Idempotent: createDeliveryOrderForSO itself guards re-creation (bails out if a
// non-cancelled DO already exists for the SO, or if there is no remaining qty).
// Re-running after a successful apply finds nothing left for the "would create"
// rows (they now have a DO); the zero-remaining rows are permanently unreachable
// through this function and stay reported, not retried.

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const DB_PATH = '/opt/crm/backend/dev.db'
const SRC_FILE = '/opt/crm/backend/src/routes/sales/shared.ts'
const DIST_FILE = '/opt/crm/backend/dist/routes/sales/shared.js'
const STATUSES = ['CONFIRMED', 'PROCESSING', 'READY', 'PARTIAL', 'DELIVERED', 'COMPLETED']

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

// ---- staleness check: is dist newer than (i.e. built after) the current src? ----
if (fs.existsSync(SRC_FILE) && fs.existsSync(DIST_FILE)) {
  const srcMtime = fs.statSync(SRC_FILE).mtimeMs
  const distMtime = fs.statSync(DIST_FILE).mtimeMs
  if (distMtime < srcMtime) {
    console.log(`WARNING: dist/routes/sales/shared.js (${new Date(distMtime).toISOString()}) is OLDER than src/routes/sales/shared.ts (${new Date(srcMtime).toISOString()}) — dist is STALE. A concurrent backend edit to src has not been rebuilt. Loaded createDeliveryOrderForSO may not match current src. Investigate before --apply.`)
  } else {
    console.log(`dist freshness OK at script start: dist/routes/sales/shared.js is not older than src/routes/sales/shared.ts (re-check immediately before --apply — another agent is editing these files concurrently).`)
  }
} else {
  console.log('WARNING: could not stat src/dist shared.ts/.js for staleness check')
}

if (APPLY) assertFreshBackup(BACKUP_PATH)

const db = new Database(DB_PATH, { readonly: !APPLY })

// Load the REAL app function from the compiled dist build (PM2 runs dist).
// Only loaded for --apply; dry run never touches it so it can never write.
let createDeliveryOrderForSO = null
if (APPLY) {
  ;({ createDeliveryOrderForSO } = require(DIST_FILE))
}

const ph = STATUSES.map(() => '?').join(',')
const candidates = db.prepare(`
  SELECT so.id, so.tenant_id, so.so_number, so.status, so.delivery_date
  FROM sales_orders so
  WHERE so.status IN (${ph})
    AND NOT EXISTS (SELECT 1 FROM delivery_orders d WHERE d.sales_order_id = so.id AND d.status != 'CANCELLED')
  ORDER BY so.tenant_id, so.so_number
`).all(...STATUSES)

function remainingQty(soId) {
  const items = db.prepare('SELECT quantity, delivered_qty FROM sales_order_items WHERE sales_order_id = ?').all(soId)
  return items.reduce((s, i) => s + Math.max(0, (i.quantity || 0) - (i.delivered_qty || 0)), 0)
}

console.log(`\n=== backfill-delivery-orders ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
console.log(`${candidates.length} SO(s) with status in [${STATUSES.join(',')}] and no non-cancelled DO\n`)

const byTenant = {}
for (const c of candidates) byTenant[c.tenant_id] = (byTenant[c.tenant_id] || 0) + 1
console.log('By tenant:', byTenant)

const willCreate = []
const zeroRemaining = []
for (const c of candidates) {
  const rem = remainingQty(c.id)
  if (rem > 0) willCreate.push({ ...c, rem })
  else zeroRemaining.push(c)
}

console.log(`\n-- would CREATE a DO via createDeliveryOrderForSO (${willCreate.length}) --`)
for (const c of willCreate) {
  console.log(`${c.so_number.padEnd(16)} ${c.tenant_id.padEnd(20)} status=${c.status.padEnd(10)} remaining_qty=${c.rem}  before: no DO  ->  after: DO created (SHIPPED, delivery_date=${c.delivery_date || '(now, SO has none)'})`)
}

console.log(`\n-- function would return null, no DO created (delivered_qty already == quantity) (${zeroRemaining.length}) --`)
for (const c of zeroRemaining) {
  console.log(`${c.so_number.padEnd(16)} ${c.tenant_id.padEnd(20)} status=${c.status.padEnd(10)} remaining_qty=0  before: no DO  ->  after: still no DO (known gap — report only, not fixed by this script)`)
}

console.log(`\nSummary: ${willCreate.length} will get a DO, ${zeroRemaining.length} cannot be backfilled through createDeliveryOrderForSO (zero remaining qty) and are reported, not inserted by hand.`)

if (!APPLY) {
  console.log('\n(dry run — no changes made. Re-run with --apply --backup=<path> to write.)')
  process.exit(0)
}

const tx = db.transaction(() => {
  for (const c of willCreate) {
    const result = createDeliveryOrderForSO(c.tenant_id, c.id, { createdBy: 'backfill-20261004' })
    console.log(result
      ? `APPLIED ${c.so_number}: created ${result.do_number} (id=${result.id})`
      : `APPLIED ${c.so_number}: function returned null (unexpected — re-check candidate selection)`)
  }
})
tx()
db.pragma('wal_checkpoint(TRUNCATE)')
console.log(`\nDone. ${willCreate.length} DO(s) created. ${zeroRemaining.length} SO(s) left as reported (no remaining qty to deliver).`)
